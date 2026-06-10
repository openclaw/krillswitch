declare namespace Cloudflare {
  interface Env {
    // Test-only binding injected by vitest.config.ts so the setup file can
    // apply migrations. Not present in wrangler.jsonc.
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}
