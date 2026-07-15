import { evaluateFlag, type FlagEvaluation } from "@openclaw/krillswitch-core";
import { count, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  type AuthBindings,
  createAuth,
  isGitHubAuthConfigured,
} from "../auth/auth";
import { isDevPersonaAuthEnabled } from "../auth/devAuth";
import {
  DEV_PERSONA_PASSWORD,
  DEV_PERSONAS,
  type DevPersonaId,
} from "../auth/personas";
import { canEditFlags, resolveRole } from "../auth/roles";
import { clearConfigCache } from "../configCache";
import { loadFlagConfigs } from "../db/flagStore";
import {
  type AdminRole,
  changeLog,
  environments,
  flags,
  projects,
  roleGrants,
} from "../db/schema";
import {
  loadFlagList,
  loadProjectDetail,
  loadProjectFlagKeys,
  resolveEnvironment,
  resolveProjectId,
  setFlagEnabled,
} from "./adminStore";
import { countChangeLog, getChangeLogEntry, listChangeLog } from "./changeLog";
import {
  createFlag,
  deleteFlag,
  loadFlagDetail,
  updateFlagDetail,
} from "./flagDetail";
import {
  flagCreateSchema,
  flagDetailUpdateSchema,
  semanticError,
} from "./flagDetailSchema";
import {
  countUsers,
  createEnvironment,
  createProject,
  deleteEnvironment,
  listKeys,
  listUsers,
  loadUser,
  rotateKey,
  setUserRole,
} from "./management";
import {
  authenticateToken,
  countTokens,
  listTokens,
  mintToken,
  revokeToken,
} from "./tokens";

// One identity shape for both session users and access tokens. Handlers read
// `actor` for change-log attribution and /me; only the session path also has a
// full SessionUser, which nothing past the middleware needs.
type Actor = {
  kind: "session" | "token";
  id: string;
  name: string;
  email: string | null;
};

type AdminContext = {
  Bindings: AuthBindings;
  Variables: {
    actor: Actor;
    role: AdminRole | null;
  };
};

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

const devLoginSchema = z.object({
  persona: z.enum(
    Object.keys(DEV_PERSONAS) as [DevPersonaId, ...DevPersonaId[]],
  ),
});

function epochMilliseconds(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export const adminRoutes = new Hono<AdminContext>();

// --- Routes below run BEFORE the session middleware (no session yet). ---

// Which sign-in methods the sign-in screen should offer.
adminRoutes.get("/auth-providers", (c) => {
  return c.json({
    github: isGitHubAuthConfigured(c.env),
    devPersonas: isDevPersonaAuthEnabled(c.env, c.req.url),
  });
});

adminRoutes.get("/dev-personas", (c) => {
  if (!isDevPersonaAuthEnabled(c.env, c.req.url)) {
    return c.json({ error: "dev_auth_disabled" }, 403);
  }
  return c.json({
    personas: Object.values(DEV_PERSONAS).map(({ id, name, role }) => ({
      id,
      name,
      role,
    })),
  });
});

adminRoutes.post("/dev-login", async (c) => {
  if (!isDevPersonaAuthEnabled(c.env, c.req.url)) {
    return c.json({ error: "dev_auth_disabled" }, 403);
  }
  const parsed = devLoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const persona = DEV_PERSONAS[parsed.data.persona];
  const auth = createAuth(c.env, { devPersonasAllowed: true });

  const credentials = { email: persona.email, password: DEV_PERSONA_PASSWORD };
  let headers: Headers;
  try {
    const signIn = await auth.api.signInEmail({
      body: credentials,
      returnHeaders: true,
    });
    headers = signIn.headers;
  } catch {
    // First login of this persona on this database: create it. The default
    // grant is seeded ONLY here so an admin's later revocation sticks.
    const signUp = await auth.api.signUpEmail({
      body: { ...credentials, name: persona.name },
      returnHeaders: true,
    });
    headers = signUp.headers;
    if (persona.role) {
      await drizzle(c.env.DB)
        .insert(roleGrants)
        .values({
          id: `grant_dev_${persona.id}`,
          userId: signUp.response.user.id,
          role: persona.role,
          grantedBy: "dev-persona-seed",
          createdAt: new Date(),
        })
        .onConflictDoNothing();
    }
  }

  for (const cookie of headers.getSetCookie()) {
    c.header("set-cookie", cookie, { append: true });
  }
  return c.json({ persona: persona.id });
});

// --- Auth middleware: an access token OR a session establishes the actor. ---

adminRoutes.use("*", async (c, next) => {
  const db = drizzle(c.env.DB);

  // Access-token path: bearer carrying the token prefix, parallel to sessions
  // on the same routes. The token's role flows straight through, so admin-only
  // routes still 403 (tokens are never admin).
  const bearer = bearerToken(c.req.header("authorization"));
  if (bearer) {
    const tokenActor = await authenticateToken(db, bearer);
    if (!tokenActor) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    c.set("actor", {
      kind: "token",
      id: `token:${tokenActor.id}`,
      name: tokenActor.name,
      email: null,
    });
    c.set("role", tokenActor.role);
    await next();
    return;
  }

  const auth = createAuth(c.env, {
    devPersonasAllowed: isDevPersonaAuthEnabled(c.env, c.req.url),
  });
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  c.set("actor", {
    kind: "session",
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  });
  c.set(
    "role",
    await resolveRole(
      db,
      session.user,
      c.env.BOOTSTRAP_ADMIN_EMAIL,
      c.env.GITHUB_VIEWER_ORG,
    ),
  );
  await next();
});

// Any authenticated caller may ask who they are — the no-access screen and the
// CLI both need it.
adminRoutes.get("/me", (c) => {
  const actor = c.get("actor");
  return c.json({
    user: { id: actor.id, name: actor.name, email: actor.email },
    role: c.get("role"),
  });
});

// --- Role middleware: everything below requires at least viewer. ---

adminRoutes.use("*", async (c, next) => {
  if (c.get("role") === null) {
    return c.json({ error: "no_access" }, 403);
  }
  await next();
});

adminRoutes.get("/projects", async (c) => {
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePage(c);
  const [rows, totalRow, flagCounts, envCounts, lastChanges] =
    await Promise.all([
      db
        .select()
        .from(projects)
        .orderBy(projects.name)
        .limit(limit)
        .offset(offset)
        .all(),
      db.select({ n: count() }).from(projects).get(),
      db
        .select({ projectId: flags.projectId, n: count() })
        .from(flags)
        .groupBy(flags.projectId)
        .all(),
      db
        .select({ projectId: environments.projectId, n: count() })
        .from(environments)
        .groupBy(environments.projectId)
        .all(),
      db
        .select({
          projectKey: changeLog.projectKey,
          last: max(changeLog.createdAt),
        })
        .from(changeLog)
        .groupBy(changeLog.projectKey)
        .all(),
    ]);

  const flagByProject = new Map(flagCounts.map((r) => [r.projectId, r.n]));
  const envByProject = new Map(envCounts.map((r) => [r.projectId, r.n]));
  const lastByKey = new Map(lastChanges.map((r) => [r.projectKey, r.last]));

  const summaries = rows.map((project) => ({
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    flagCount: flagByProject.get(project.id) ?? 0,
    environmentCount: envByProject.get(project.id) ?? 0,
    lastChangeAt: epochMilliseconds(lastByKey.get(project.key)),
  }));

  return c.json({ projects: summaries, total: totalRow?.n ?? 0 });
});

// Append-only audit trail: read-only here by design; there are no update
// or delete routes for it anywhere.
adminRoutes.get("/changelog", async (c) => {
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePage(c);
  const filter = {
    flagKey: c.req.query("flagKey")?.trim() || undefined,
    projectKey: c.req.query("projectKey")?.trim() || undefined,
  };
  const [entries, total] = await Promise.all([
    listChangeLog(db, { ...filter, limit, offset }),
    countChangeLog(db, filter),
  ]);
  return c.json({ entries, total });
});

adminRoutes.get("/changelog/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const entry = await getChangeLogEntry(db, c.req.param("id"));
  if (!entry) return c.json({ error: "not found" }, 404);
  return c.json({ entry });
});

// --- Admin-only management: grants, projects, environments, keys. ---

const keySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const createProjectSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(120),
});
const setRoleSchema = z.object({
  role: z.enum(["admin", "editor", "viewer"]).nullable(),
});
const mintTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // Tokens are editor/viewer only — admin is intentionally not accepted.
  role: z.enum(["editor", "viewer"]),
});

// Explicit per-handler guard: route registration order doesn't matter.
function forbidNonAdmin(c: Context<AdminContext>) {
  return c.get("role") === "admin" ? null : c.json({ error: "forbidden" }, 403);
}

// Shared list pagination: ?limit (1..100, default 50) and ?offset (>=0).
function parsePage(
  c: Context<AdminContext>,
  defaultLimit = 50,
): { limit: number; offset: number } {
  const rawLimit = Number.parseInt(c.req.query("limit") ?? "", 10);
  const rawOffset = Number.parseInt(c.req.query("offset") ?? "", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(100, Math.max(1, rawLimit))
    : defaultLimit;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
  return { limit, offset };
}

adminRoutes.get("/tokens", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePage(c);
  const [tokens, total] = await Promise.all([
    listTokens(db, { limit, offset }),
    countTokens(db),
  ]);
  return c.json({ tokens, total });
});

adminRoutes.post("/tokens", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const parsed = mintTokenSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const minted = await mintToken(drizzle(c.env.DB), {
    name: parsed.data.name,
    role: parsed.data.role,
    actor: c.get("actor"),
  });
  // Plaintext returned exactly once; only the hash is stored.
  return c.json({ id: minted.id, token: minted.token }, 201);
});

adminRoutes.post("/tokens/:id/revoke", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const revoked = await revokeToken(
    drizzle(c.env.DB),
    c.req.param("id"),
    c.get("actor"),
  );
  if (!revoked) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ revoked: c.req.param("id") });
});

adminRoutes.get("/users", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePage(c);
  const [users, total] = await Promise.all([
    listUsers(db, { limit, offset }),
    countUsers(db),
  ]);
  return c.json({ users, total });
});

adminRoutes.get("/users/:userId", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const member = await loadUser(drizzle(c.env.DB), c.req.param("userId"));
  if (!member) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ user: member });
});

// Tokens this member minted (shown on their profile).
adminRoutes.get("/users/:userId/tokens", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePage(c);
  const createdBy = c.req.param("userId");
  const [tokens, total] = await Promise.all([
    listTokens(db, { limit, offset }, { createdBy }),
    countTokens(db, { createdBy }),
  ]);
  return c.json({ tokens, total });
});

// This member's audit-trail entries (where they were the actor).
adminRoutes.get("/users/:userId/changelog", async (c) => {
  const db = drizzle(c.env.DB);
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const { limit, offset } = parsePage(c);
  const filter = { actorUserId: c.req.param("userId") };
  const [entries, total] = await Promise.all([
    listChangeLog(db, { ...filter, limit, offset }),
    countChangeLog(db, filter),
  ]);
  return c.json({ entries, total });
});

adminRoutes.put("/users/:userId/role", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const parsed = setRoleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const actor = c.get("actor");
  const outcome = await setUserRole(drizzle(c.env.DB), {
    userId: c.req.param("userId"),
    role: parsed.data.role,
    actor: { id: actor.id, name: actor.name },
  });
  switch (outcome) {
    case "not_found":
      return c.json({ error: "not_found" }, 404);
    case "last_admin":
      return c.json(
        {
          error: "last_admin",
          message: "the last admin cannot be demoted or revoked",
        },
        400,
      );
    case "ok":
      return c.json({ userId: c.req.param("userId"), role: parsed.data.role });
  }
});

adminRoutes.post("/projects", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const parsed = createProjectSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const actor = c.get("actor");
  const outcome = await createProject(drizzle(c.env.DB), {
    ...parsed.data,
    actor: { id: actor.id, name: actor.name },
  });
  if (outcome === "duplicate_key") {
    return c.json({ error: "duplicate_key" }, 409);
  }
  return c.json({ created: parsed.data.key }, 201);
});

adminRoutes.post("/projects/:projectKey/environments", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const parsed = createProjectSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const db = drizzle(c.env.DB);
  const projectKey = c.req.param("projectKey");
  const projectId = await resolveProjectId(db, projectKey);
  if (!projectId) {
    return c.json({ error: "not_found" }, 404);
  }
  const actor = c.get("actor");
  const outcome = await createEnvironment(db, {
    projectId,
    projectKey,
    key: parsed.data.key,
    name: parsed.data.name,
    actor: { id: actor.id, name: actor.name },
  });
  if (outcome.kind === "duplicate_key") {
    return c.json({ error: "duplicate_key" }, 409);
  }
  clearConfigCache();
  return c.json({ created: parsed.data.key, evalKey: outcome.evalKey }, 201);
});

adminRoutes.delete(
  "/projects/:projectKey/environments/:environmentKey",
  async (c) => {
    const forbidden = forbidNonAdmin(c);
    if (forbidden) return forbidden;
    const db = drizzle(c.env.DB);
    const projectKey = c.req.param("projectKey");
    const projectId = await resolveProjectId(db, projectKey);
    if (!projectId) {
      return c.json({ error: "not_found" }, 404);
    }
    const environmentKey = c.req.param("environmentKey");
    const actor = c.get("actor");
    const deleted = await deleteEnvironment(db, {
      projectId,
      projectKey,
      environmentKey,
      actor: { id: actor.id, name: actor.name },
    });
    if (!deleted) {
      return c.json({ error: "not_found" }, 404);
    }
    clearConfigCache();
    return c.json({ deleted: environmentKey });
  },
);

adminRoutes.get("/projects/:projectKey/keys", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const db = drizzle(c.env.DB);
  const projectId = await resolveProjectId(db, c.req.param("projectKey"));
  if (!projectId) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ keys: await listKeys(db, projectId) });
});

adminRoutes.post(
  "/projects/:projectKey/environments/:environmentKey/keys/rotate",
  async (c) => {
    const forbidden = forbidNonAdmin(c);
    if (forbidden) return forbidden;
    const db = drizzle(c.env.DB);
    const projectKey = c.req.param("projectKey");
    const projectId = await resolveProjectId(db, projectKey);
    if (!projectId) {
      return c.json({ error: "not_found" }, 404);
    }
    const actor = c.get("actor");
    const outcome = await rotateKey(db, {
      projectId,
      projectKey,
      environmentKey: c.req.param("environmentKey"),
      actor: { id: actor.id, name: actor.name },
    });
    if (outcome.kind === "not_found") {
      return c.json({ error: "not_found" }, 404);
    }
    clearConfigCache();
    return c.json({ evalKey: outcome.evalKey });
  },
);

adminRoutes.get("/projects/:projectKey", async (c) => {
  const detail = await loadProjectDetail(
    drizzle(c.env.DB),
    c.req.param("projectKey"),
  );
  if (!detail) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(detail);
});

// Project-level flag keys for filter UIs (e.g. the change log combobox).
// Viewer-readable, like the change log it filters.
adminRoutes.get("/projects/:projectKey/flags", async (c) => {
  const db = drizzle(c.env.DB);
  const projectId = await resolveProjectId(db, c.req.param("projectKey"));
  if (!projectId) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ flags: await loadProjectFlagKeys(db, projectId) });
});

const evalContextSchema = z.object({
  context: z.object({
    key: z.string().min(1),
    attributes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  }),
});

// Operator eval: "what would this context resolve to here", authed with the
// caller's admin token/session — not the public eval key. Reuses the same
// pure evaluator as POST /v1/eval.
adminRoutes.post(
  "/projects/:projectKey/environments/:environmentKey/eval",
  async (c) => {
    const parsed = evalContextSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const db = drizzle(c.env.DB);
    const environment = await resolveEnvironment(
      db,
      c.req.param("projectKey"),
      c.req.param("environmentKey"),
    );
    if (!environment) {
      return c.json({ error: "not_found" }, 404);
    }
    const configs = await loadFlagConfigs(db, environment.environmentId);
    const flags: Record<string, FlagEvaluation> = {};
    for (const flagConfig of configs) {
      flags[flagConfig.key] = evaluateFlag(flagConfig, parsed.data.context);
    }
    return c.json({ flags });
  },
);

adminRoutes.get(
  "/projects/:projectKey/environments/:environmentKey/flags",
  async (c) => {
    const db = drizzle(c.env.DB);
    const environment = await resolveEnvironment(
      db,
      c.req.param("projectKey"),
      c.req.param("environmentKey"),
    );
    if (!environment) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ flags: await loadFlagList(db, environment.environmentId) });
  },
);

adminRoutes.get(
  "/projects/:projectKey/environments/:environmentKey/flags/:flagKey",
  async (c) => {
    const db = drizzle(c.env.DB);
    const environment = await resolveEnvironment(
      db,
      c.req.param("projectKey"),
      c.req.param("environmentKey"),
    );
    if (!environment) {
      return c.json({ error: "not_found" }, 404);
    }
    const detail = await loadFlagDetail(db, {
      projectId: environment.projectId,
      environmentId: environment.environmentId,
      flagKey: c.req.param("flagKey"),
    });
    if (!detail) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(detail);
  },
);

adminRoutes.put(
  "/projects/:projectKey/environments/:environmentKey/flags/:flagKey",
  async (c) => {
    const role = c.get("role");
    if (role === null || !canEditFlags(role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const parsed = flagDetailUpdateSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const db = drizzle(c.env.DB);
    const environment = await resolveEnvironment(
      db,
      c.req.param("projectKey"),
      c.req.param("environmentKey"),
    );
    if (!environment) {
      return c.json({ error: "not_found" }, 404);
    }
    const flagKey = c.req.param("flagKey");
    const flag = await loadFlagDetail(db, {
      projectId: environment.projectId,
      environmentId: environment.environmentId,
      flagKey,
    });
    if (!flag) {
      return c.json({ error: "not_found" }, 404);
    }
    const inconsistency = semanticError(flag.flag.kind, parsed.data);
    if (inconsistency) {
      return c.json({ error: "invalid_request", message: inconsistency }, 400);
    }
    const actor = c.get("actor");
    const outcome = await updateFlagDetail(db, {
      projectId: environment.projectId,
      environmentId: environment.environmentId,
      flagKey,
      draft: parsed.data,
      actor: { id: actor.id, name: actor.name },
      projectKey: c.req.param("projectKey"),
      environmentKey: c.req.param("environmentKey"),
    });
    switch (outcome.kind) {
      case "not_found":
        return c.json({ error: "not_found" }, 404);
      case "invalid":
        return c.json(
          { error: "invalid_request", message: outcome.message },
          400,
        );
      case "variation_in_use":
        return c.json(
          { error: "variation_in_use", message: outcome.message },
          400,
        );
      case "ok":
        clearConfigCache();
        return c.json(outcome.detail);
    }
  },
);

adminRoutes.post("/projects/:projectKey/flags", async (c) => {
  const role = c.get("role");
  if (role === null || !canEditFlags(role)) {
    return c.json({ error: "forbidden" }, 403);
  }
  const parsed = flagCreateSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const inconsistency = semanticError(parsed.data.kind, {
    variations: parsed.data.variations,
    offVariationIndex: parsed.data.offVariationIndex,
    defaultVariationIndex: parsed.data.defaultVariationIndex,
    targets: [],
    rules: [],
    rollout: null,
  });
  if (inconsistency) {
    return c.json({ error: "invalid_request", message: inconsistency }, 400);
  }
  const db = drizzle(c.env.DB);
  const projectId = await resolveProjectId(db, c.req.param("projectKey"));
  if (!projectId) {
    return c.json({ error: "not_found" }, 404);
  }
  const actor = c.get("actor");
  const outcome = await createFlag(db, {
    projectId,
    draft: parsed.data,
    actor: { id: actor.id, name: actor.name },
    projectKey: c.req.param("projectKey"),
  });
  switch (outcome.kind) {
    case "duplicate_key":
      return c.json({ error: "duplicate_key" }, 409);
    case "invalid":
      return c.json(
        { error: "invalid_request", message: outcome.message },
        400,
      );
    case "ok":
      clearConfigCache();
      return c.json({ created: parsed.data.key }, 201);
  }
});

adminRoutes.delete("/projects/:projectKey/flags/:flagKey", async (c) => {
  if (c.get("role") !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }
  const db = drizzle(c.env.DB);
  const projectId = await resolveProjectId(db, c.req.param("projectKey"));
  if (!projectId) {
    return c.json({ error: "not_found" }, 404);
  }
  const actor = c.get("actor");
  const deleted = await deleteFlag(db, {
    projectId,
    flagKey: c.req.param("flagKey"),
    actor: { id: actor.id, name: actor.name },
    projectKey: c.req.param("projectKey"),
  });
  if (!deleted) {
    return c.json({ error: "not_found" }, 404);
  }
  clearConfigCache();
  return c.json({ deleted: c.req.param("flagKey") });
});

const toggleFlagSchema = z.object({ enabled: z.boolean() });

adminRoutes.patch(
  "/projects/:projectKey/environments/:environmentKey/flags/:flagKey",
  async (c) => {
    const role = c.get("role");
    if (role === null || !canEditFlags(role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const parsed = toggleFlagSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const db = drizzle(c.env.DB);
    const environment = await resolveEnvironment(
      db,
      c.req.param("projectKey"),
      c.req.param("environmentKey"),
    );
    if (!environment) {
      return c.json({ error: "not_found" }, 404);
    }
    const actor = c.get("actor");
    const flag = await setFlagEnabled(db, {
      environmentId: environment.environmentId,
      flagKey: c.req.param("flagKey"),
      enabled: parsed.data.enabled,
      actor: { id: actor.id, name: actor.name },
      projectKey: c.req.param("projectKey"),
      environmentKey: c.req.param("environmentKey"),
    });
    if (!flag) {
      return c.json({ error: "not_found" }, 404);
    }
    // This isolate serves the next eval read fresh; other isolates converge
    // within the ≤1s config-cache TTL.
    clearConfigCache();
    return c.json({ flag });
  },
);
