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
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

/** GitHub login exists wherever an OAuth app's credentials are configured. */
export function isGitHubAuthConfigured(
  env: Pick<AuthBindings, "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET">,
): boolean {
  return Boolean(
    env.GITHUB_CLIENT_ID?.trim() && env.GITHUB_CLIENT_SECRET?.trim(),
  );
}

/**
 * Built per request: env bindings only exist inside a request, and the
 * email/password provider must be decided from the request.
 *
 * Provider boundary: this function is the single place identity providers
 * are wired. GitHub is the current real provider; swapping or adding one for
 * a future migration is a change here plus env vars — role grants key on the
 * better-auth user id, so they survive provider changes.
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
    ...(isGitHubAuthConfigured(env)
      ? {
          socialProviders: {
            github: {
              clientId: env.GITHUB_CLIENT_ID ?? "",
              clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
            },
          },
        }
      : {}),
    telemetry: { enabled: false },
  });
}

export type SessionUser = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>>
>["user"];
