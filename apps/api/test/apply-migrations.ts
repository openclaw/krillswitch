import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside per-test storage isolation and may run multiple
// times; applyD1Migrations only applies migrations that haven't run yet.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
