// CLI-only config: `bun run db:generate-auth` introspects this to emit
// src/db/authSchema.ts. The runtime auth instance lives in src/auth/auth.ts
// and must stay option-compatible with this file where schema is concerned.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export const auth = betterAuth({
  database: drizzleAdapter({}, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      orgViewer: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
});
