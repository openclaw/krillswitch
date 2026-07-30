import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getEnvironmentConfig } from "./configCache";
import { bearerToken } from "./evalShared";

/** GET /v1/stream — Server-Sent Events "config changed" signal.
 *
 *  Payloads never stream here: the event carries only a monotonically
 *  increasing version (the project's newest change-log rowid), and clients
 *  refetch /v1/eval — whose ETag makes a no-op refetch cheap. Each
 *  connection polls D1 at a gentle interval and ends after a fixed window;
 *  EventSource reconnects automatically, which re-resolves the eval key.
 *  A Durable Object fan-out can replace the poll without changing the wire
 *  contract. */

type Bindings = {
  DB: D1Database;
  /** Test seams; production uses the defaults. */
  STREAM_POLL_MS?: string;
  STREAM_MAX_MS?: string;
};

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_MAX_MS = 300_000;

/** The project's newest change-log rowid: bumps on every audited admin
 *  mutation (flags, segments, environments), which is exactly the set of
 *  changes that can alter eval results. */
async function changeVersion(
  db: D1Database,
  projectKey: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COALESCE(MAX(rowid), 0) AS version FROM change_log WHERE project_key = ?",
    )
    .bind(projectKey)
    .first<{ version: number }>();
  return row?.version ?? 0;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const streamRoutes = new Hono<{ Bindings: Bindings }>();

streamRoutes.get("/v1/stream", async (c) => {
  // EventSource cannot set headers; eval keys are public flag-set
  // identifiers (not secrets), so ?key= is an equal-trust alternative.
  const evalKey =
    bearerToken(c.req.header("authorization")) ?? c.req.query("key");
  if (!evalKey) {
    return c.json({ error: "missing_eval_key" }, 401);
  }
  const { config } = await getEnvironmentConfig(c.env.DB, evalKey);
  if (!config) {
    return c.json({ error: "invalid_eval_key" }, 401);
  }
  const { projectKey } = config;
  const pollMs = positiveInt(c.env.STREAM_POLL_MS, DEFAULT_POLL_MS);
  const maxMs = positiveInt(c.env.STREAM_MAX_MS, DEFAULT_MAX_MS);

  c.header("Cache-Control", "no-store");
  return streamSSE(c, async (stream) => {
    let version = await changeVersion(c.env.DB, projectKey);
    // The opening event hands the client its baseline so a change that
    // raced the connection still triggers one refetch.
    await stream.writeSSE({
      event: "hello",
      data: JSON.stringify({ version }),
    });
    const deadline = Date.now() + maxMs;
    while (!stream.aborted && Date.now() < deadline) {
      await stream.sleep(pollMs);
      if (stream.aborted) break;
      const current = await changeVersion(c.env.DB, projectKey);
      if (current !== version) {
        version = current;
        await stream.writeSSE({
          event: "change",
          data: JSON.stringify({ version }),
        });
      } else {
        // Comment frame keeps proxies from idling the connection out.
        await stream.write(": keepalive\n\n");
      }
    }
  });
});
