import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "../db/authSchema";
import { syncOrgViewerMembership } from "./orgMembership";

export type AuthBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  DEV_AUTH_ENABLED?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_VIEWER_ORG?: string;
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
  const db = drizzle(env.DB);
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: options.devPersonasAllowed },
    user: {
      additionalFields: {
        // Cached "member of GITHUB_VIEWER_ORG" — read by role resolution as
        // the viewer fallback. Must stay in sync with auth-schema.config.ts.
        orgViewer: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    databaseHooks: {
      account: {
        // Covers the first GitHub link (create) and every later sign-in
        // (better-auth refreshes the stored tokens → update).
        create: {
          after: async (account) => {
            await syncOrgViewerMembership(db, env, account);
          },
        },
        update: {
          after: async (account) => {
            await syncOrgViewerMembership(db, env, account);
          },
        },
      },
    },
    ...(isGitHubAuthConfigured(env)
      ? {
          socialProviders: {
            github: {
              clientId: env.GITHUB_CLIENT_ID ?? "",
              clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
              scope: ["read:user", "user:email", "read:org"],
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
