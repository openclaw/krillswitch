import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import { clearConfigCache } from "../src/configCache";

const DEV_EVAL_KEY = "ks_clawhub_development_local";

async function applySeed(): Promise<void> {
  const statements = seedSql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
}

/** Reads SSE frames until `predicate` matches one or the stream ends.
 *  Returns every parsed `{event, data}` frame seen. */
async function readEvents(
  response: Response,
  predicate: (event: { event: string; data: string }) => boolean,
  timeoutMs = 1_500,
): Promise<{ event: string; data: string }[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("stream response has no body");
  const decoder = new TextDecoder();
  const events: { event: string; data: string }[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        const eventLine = frame
          .split("\n")
          .find((line) => line.startsWith("event:"));
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!eventLine || !dataLine) continue; // keepalive comment
        const parsed = {
          event: eventLine.slice(6).trim(),
          data: dataLine.slice(5).trim(),
        };
        events.push(parsed);
        if (predicate(parsed)) {
          return events;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return events;
}

async function insertChange(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO change_log (id, actor_user_id, actor_name, action, project_key, flag_key, target, before, after, created_at) VALUES (?, 'u_test', 'Test', 'flag.toggle', 'clawhub', 'souls', 'clawhub/souls', NULL, NULL, ?)",
  )
    .bind(`chg_stream_${crypto.randomUUID()}`, Date.now())
    .run();
}

beforeAll(async () => {
  await applySeed();
});

beforeEach(() => {
  clearConfigCache();
});

describe("GET /v1/stream", () => {
  it("opens with a hello event carrying the current version", async () => {
    const response = await SELF.fetch(
      `https://krillswitch.test/v1/stream?key=${DEV_EVAL_KEY}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(response, (e) => e.event === "hello");
    expect(events[0]?.event).toBe("hello");
    const payload = JSON.parse(events[0]?.data ?? "{}") as { version: number };
    expect(typeof payload.version).toBe("number");
  });

  it("emits a change event when the project's change log advances", async () => {
    const response = await SELF.fetch(
      `https://krillswitch.test/v1/stream?key=${DEV_EVAL_KEY}`,
    );
    const hello = await readEvents(response.clone(), () => true);
    expect(hello.length).toBeGreaterThan(0);
    // Race the poll loop: insert after the stream is open.
    await insertChange();
    const events = await readEvents(response, (e) => e.event === "change");
    const change = events.find((e) => e.event === "change");
    expect(change).toBeDefined();
    const payload = JSON.parse(change?.data ?? "{}") as { version: number };
    expect(payload.version).toBeGreaterThan(0);
  });

  it("accepts the eval key as a bearer header too", async () => {
    const response = await SELF.fetch("https://krillswitch.test/v1/stream", {
      headers: { authorization: `Bearer ${DEV_EVAL_KEY}` },
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it("rejects a missing or unknown eval key", async () => {
    const missing = await SELF.fetch("https://krillswitch.test/v1/stream");
    expect(missing.status).toBe(401);
    const unknown = await SELF.fetch(
      "https://krillswitch.test/v1/stream?key=ks_nope",
    );
    expect(unknown.status).toBe(401);
  });

  it("serves the stream on the public eval hostname and blocks it on admin", async () => {
    const publicHost = await SELF.fetch(
      `https://flags.openclaw.ai/v1/stream?key=${DEV_EVAL_KEY}`,
    );
    expect(publicHost.status).toBe(200);
    await publicHost.body?.cancel();
    const adminHost = await SELF.fetch(
      `https://switch.openclaw.ai/v1/stream?key=${DEV_EVAL_KEY}`,
    );
    expect(adminHost.status).toBe(404);
  });
});
