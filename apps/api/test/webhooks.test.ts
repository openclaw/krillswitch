import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import { drainWebhooks } from "../src/admin/webhooks";
import { changeLog, webhooks } from "../src/db/schema";

const BASE = "http://localhost";

beforeAll(async () => {
  const statements = seedSql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

async function devLogin(persona: string): Promise<string> {
  const response = await SELF.fetch(`${BASE}/admin/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ persona }),
  });
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
}

describe("webhook admin API", () => {
  it("admin can create, list, disable, and delete a webhook", async () => {
    const cookie = await devLogin("admin");
    const created = await SELF.fetch(`${BASE}/admin/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Ops notify",
        url: "https://example.com/hook",
      }),
    });
    expect(created.status).toBe(201);
    const { created: id } = await created.json<{ created: string }>();

    const list = await SELF.fetch(`${BASE}/admin/webhooks`, {
      headers: { cookie },
    });
    const body = await list.json<{
      webhooks: { id: string; enabled: boolean }[];
    }>();
    expect(body.webhooks.some((hook) => hook.id === id)).toBe(true);

    const disabled = await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disabled.status).toBe(200);

    const deleted = await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleted.status).toBe(200);
  });

  it("editors cannot manage webhooks", async () => {
    const cookie = await devLogin("editor");
    const response = await SELF.fetch(`${BASE}/admin/webhooks`, {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
  });
});

describe("drainWebhooks", () => {
  it("posts new change-log entries once and advances the cursor", async () => {
    const cookie = await devLogin("admin");
    const created = await SELF.fetch(`${BASE}/admin/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Drain test",
        url: "https://drain.example/hook",
      }),
    });
    const { created: id } = await created.json<{ created: string }>();

    // A change made after the webhook exists (creating it starts at tail).
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ enabled: true, comment: "webhook drain test" }),
      },
    );

    const posts: { url: string; body: string }[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(input), body: String(init?.body) });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const db = drizzle(env.DB);
    await drainWebhooks(db, fakeFetch);
    const drainTestPosts = posts.filter((post) =>
      post.url.startsWith("https://drain.example/"),
    );
    expect(drainTestPosts.length).toBeGreaterThan(0);
    expect(
      drainTestPosts.some((post) => post.body.includes("webhook drain test")),
    ).toBe(true);

    // Second drain: cursor advanced, nothing new to send.
    posts.length = 0;
    await drainWebhooks(db, fakeFetch);
    expect(
      posts.filter((p) => p.url.startsWith("https://drain.example/")),
    ).toHaveLength(0);

    await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
  });

  it("times out one delivery without dropping queued entries or blocking other hooks", async () => {
    const db = drizzle(env.DB);
    const tail = await db
      .select({ rowid: sql<number>`coalesce(max(rowid), 0)` })
      .from(changeLog)
      .get();
    const hookIds = [crypto.randomUUID(), crypto.randomUUID()];
    const entryIds = [crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(webhooks).values(
      hookIds.map((id, index) => ({
        id,
        name: `Timeout test ${index}`,
        url:
          index === 0
            ? "https://hang.example/hook"
            : "https://healthy.example/hook",
        cursor: tail?.rowid ?? 0,
        createdAt: new Date(),
      })),
    );
    await db.insert(changeLog).values(
      entryIds.map((id) => ({
        id,
        actorUserId: "timeout-test",
        actorName: "Timeout test",
        action: "flag.update" as const,
        target: "timeout-test",
        createdAt: new Date(),
      })),
    );
    try {
      const attempted: { url: string; id: string }[] = [];
      const hangingFetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);
        attempted.push({ url, id: JSON.parse(String(init?.body)).entry.id });
        if (url !== "https://hang.example/hook") return new Response("ok");
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(signal?.reason);
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
      }) as typeof fetch;
      await drainWebhooks(db, hangingFetch, 20);
      expect(
        attempted
          .filter(({ url }) => url === "https://hang.example/hook")
          .map(({ id }) => id),
      ).toEqual([entryIds[0]]);
      expect(
        attempted
          .filter(({ url }) => url === "https://healthy.example/hook")
          .map(({ id }) => id),
      ).toEqual(entryIds);
      const timedOut = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, hookIds[0] as string))
        .get();
      expect(timedOut?.lastStatus).toBe("timeout");

      attempted.length = 0;
      const recoveredFetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        attempted.push({
          url: String(input),
          id: JSON.parse(String(init?.body)).entry.id,
        });
        return new Response("ok");
      }) as typeof fetch;
      await drainWebhooks(db, recoveredFetch, 20);
      expect(attempted).toEqual([
        { url: "https://hang.example/hook", id: entryIds[1] },
      ]);
      attempted.length = 0;
      await drainWebhooks(db, recoveredFetch, 20);
      expect(attempted).toEqual([]);
    } finally {
      await db.delete(webhooks).where(inArray(webhooks.id, hookIds));
      await db.delete(changeLog).where(inArray(changeLog.id, entryIds));
    }
  }, 3_000);
});
