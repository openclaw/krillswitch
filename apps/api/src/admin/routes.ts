import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthBindings, createAuth, type SessionUser } from "../auth/auth";
import { isDevPersonaAuthEnabled } from "../auth/devAuth";
import {
  DEV_PERSONA_PASSWORD,
  DEV_PERSONAS,
  type DevPersonaId,
} from "../auth/personas";
import { resolveRole } from "../auth/roles";
import { type AdminRole, projects, roleGrants } from "../db/schema";

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
  let userId: string;
  try {
    const signIn = await auth.api.signInEmail({
      body: credentials,
      returnHeaders: true,
    });
    headers = signIn.headers;
    userId = signIn.response.user.id;
  } catch {
    // First login of this persona on this database: create it.
    const signUp = await auth.api.signUpEmail({
      body: { ...credentials, name: persona.name },
      returnHeaders: true,
    });
    headers = signUp.headers;
    userId = signUp.response.user.id;
  }

  if (persona.role) {
    await drizzle(c.env.DB)
      .insert(roleGrants)
      .values({
        id: `grant_dev_${persona.id}`,
        userId,
        role: persona.role,
        grantedBy: "dev-persona-seed",
        createdAt: new Date(),
      })
      .onConflictDoNothing();
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
