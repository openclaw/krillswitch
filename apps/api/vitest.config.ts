import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            // Test-only binding so the setup file can apply migrations.
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: "krillswitch-test-secret",
            BETTER_AUTH_URL: "http://localhost",
            DEV_AUTH_ENABLED: "1",
            // Fast SSE ticks so stream tests finish in milliseconds.
            STREAM_POLL_MS: "40",
            STREAM_MAX_MS: "2000",
            // Pin auth-provider env: the pool also loads the developer's
            // .dev.vars, and real GitHub credentials there must not flip
            // test behavior.
            GITHUB_CLIENT_ID: "",
            GITHUB_CLIENT_SECRET: "",
            GITHUB_VIEWER_ORG: "",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      // Test files share D1 storage and mutate the same seeded rows;
      // parallel files race each other's flag toggles.
      fileParallelism: false,
    },
  };
});
