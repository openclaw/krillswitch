import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "../db/authSchema";

export type AuthBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  DEV_AUTH_ENABLED?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
};

/**
 * Built per request: env bindings only exist inside a request, and the
 * email/password provider must be decided from the request (dev personas are
 * the only credential path until a real provider is chosen — swap here).
 */
export function createAuth(
  env: AuthBindings,
  options: { devPersonasAllowed: boolean },
) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DB), {
      provider: "sqlite",
      schema: authSchema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: options.devPersonasAllowed },
    telemetry: { enabled: false },
  });
}

export type SessionUser = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>>
>["user"];
