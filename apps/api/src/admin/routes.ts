import { drizzle } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AuthBindings, createAuth, type SessionUser } from "../auth/auth";
import { isDevPersonaAuthEnabled } from "../auth/devAuth";
import {
  DEV_PERSONA_PASSWORD,
  DEV_PERSONAS,
  type DevPersonaId,
} from "../auth/personas";
import { canEditFlags, resolveRole } from "../auth/roles";
import { clearConfigCache } from "../configCache";
import { type AdminRole, projects, roleGrants } from "../db/schema";
import {
  loadFlagList,
  loadProjectDetail,
  resolveEnvironment,
  resolveProjectId,
  setFlagEnabled,
} from "./adminStore";
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
  createEnvironment,
  createProject,
  listKeys,
  listUsers,
  rotateKey,
  setUserRole,
} from "./management";

type AdminContext = {
  Bindings: AuthBindings;
  Variables: {
    user: SessionUser;
    role: AdminRole | null;
  };
};

const devLoginSchema = z.object({
  persona: z.enum(
    Object.keys(DEV_PERSONAS) as [DevPersonaId, ...DevPersonaId[]],
  ),
});

export const adminRoutes = new Hono<AdminContext>();

// --- Routes below run BEFORE the session middleware (no session yet). ---

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

// --- Session middleware: everything below requires a signed-in user. ---

adminRoutes.use("*", async (c, next) => {
  const auth = createAuth(c.env, {
    devPersonasAllowed: isDevPersonaAuthEnabled(c.env, c.req.url),
  });
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  c.set("user", session.user);
  c.set(
    "role",
    await resolveRole(
      drizzle(c.env.DB),
      session.user,
      c.env.BOOTSTRAP_ADMIN_EMAIL,
    ),
  );
  await next();
});

// Any signed-in user may ask who they are — the no-access screen needs it.
adminRoutes.get("/me", (c) => {
  const user = c.get("user");
  return c.json({
    user: { id: user.id, name: user.name, email: user.email },
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
  const rows = await drizzle(c.env.DB).select().from(projects).all();
  return c.json({ projects: rows });
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

// Explicit per-handler guard: route registration order doesn't matter.
function forbidNonAdmin(c: Context<AdminContext>) {
  return c.get("role") === "admin" ? null : c.json({ error: "forbidden" }, 403);
}

adminRoutes.get("/users", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  return c.json({ users: await listUsers(drizzle(c.env.DB)) });
});

adminRoutes.put("/users/:userId/role", async (c) => {
  const forbidden = forbidNonAdmin(c);
  if (forbidden) return forbidden;
  const parsed = setRoleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const outcome = await setUserRole(drizzle(c.env.DB), {
    userId: c.req.param("userId"),
    role: parsed.data.role,
    grantedBy: c.get("user").id,
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
  const outcome = await createProject(drizzle(c.env.DB), parsed.data);
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
  const outcome = await createEnvironment(db, {
    projectId,
    projectKey,
    key: parsed.data.key,
    name: parsed.data.name,
  });
  if (outcome.kind === "duplicate_key") {
    return c.json({ error: "duplicate_key" }, 409);
  }
  clearConfigCache();
  return c.json({ created: parsed.data.key, evalKey: outcome.evalKey }, 201);
});

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
    const outcome = await rotateKey(db, {
      projectId,
      projectKey,
      environmentKey: c.req.param("environmentKey"),
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
    const outcome = await updateFlagDetail(db, {
      projectId: environment.projectId,
      environmentId: environment.environmentId,
      flagKey,
      draft: parsed.data,
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
  const outcome = await createFlag(db, { projectId, draft: parsed.data });
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
  const deleted = await deleteFlag(db, {
    projectId,
    flagKey: c.req.param("flagKey"),
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
    const flag = await setFlagEnabled(db, {
      environmentId: environment.environmentId,
      flagKey: c.req.param("flagKey"),
      enabled: parsed.data.enabled,
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
