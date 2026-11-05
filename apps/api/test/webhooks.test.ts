import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import {
  assertPublicHttpsWebhookUrl,
  assertResolvedWebhookUrl,
  drainWebhooks,
  setWebhookUrl,
  WebhookUrlError,
} from "../src/admin/webhooks";
import { changeLog, webhooks } from "../src/db/schema";

const BASE = "http://localhost";

beforeAll(async () => {
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://cloudflare-dns.com") return new Response("ok");
    const blocked = url.searchParams.get("name") === "private.example";
    return Response.json({
      Status: 0,
      Answer: [{ type: 1, data: blocked ? "169.254.169.254" : "8.8.8.8" }],
    });
  }) as typeof fetch);
  const statements = seedSql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

afterAll(() => vi.unstubAllGlobals());

describe("resolved webhook addresses", () => {
  it("uses the Workers-supported manual redirect mode for DNS", async () => {
    let lookups = 0;
    const resolver = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      lookups++;
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "8.8.8.8" }],
      });
    }) as typeof fetch;
    await expect(
      assertResolvedWebhookUrl("https://public.example/hook", resolver),
    ).resolves.toBeInstanceOf(URL);
    expect(lookups).toBe(2);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:7f00:1",
  ])("rejects a public name resolving to %s", async (address) => {
    const resolver = (async () =>
      Response.json({
        Status: 0,
        Answer: [{ type: address.includes(":") ? 28 : 1, data: address }],
      })) as typeof fetch;
    await expect(
      assertResolvedWebhookUrl("https://public.example/hook", resolver),
    ).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it("checks AAAA even when A is public and rejects mixed public/private answers", async () => {
    const resolver = (async (input: RequestInfo | URL) =>
      Response.json({
        Status: 0,
        Answer:
          new URL(String(input)).searchParams.get("type") === "A"
            ? [{ type: 1, data: "8.8.8.8" }]
            : [
                { type: 28, data: "2606:4700::1111" },
                { type: 28, data: "fd00::1" },
              ],
      })) as typeof fetch;
    await expect(
      assertResolvedWebhookUrl("https://public.example/hook", resolver),
    ).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it.each([
    { Status: 2 },
    { Status: 0, Answer: [] },
    { Status: 0, Answer: [{ type: 1, data: "not-an-ip" }] },
  ])("fails closed for unusable DNS answers", async (answer) => {
    await expect(
      assertResolvedWebhookUrl("https://public.example/hook", (async () =>
        Response.json(answer)) as typeof fetch),
    ).rejects.toThrow();
  });
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

describe("assertPublicHttpsWebhookUrl", () => {
  it("accepts public https URLs", () => {
    expect(assertPublicHttpsWebhookUrl("https://example.com/hook").href).toBe(
      "https://example.com/hook",
    );
  });

  it("rejects http, userinfo, loopback, and metadata hosts", () => {
    for (const url of [
      "http://example.com/hook",
      "https://user:pass@example.com/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.9/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/hook",
      "https://metadata.google.internal/",
      "https://[::1]/hook",
      "https://[fe80::1]/hook",
      "https://[fc00::1]/hook",
      "https://[fd12::1]/hook",
      "https://[::ffff:127.0.0.1]/hook",
      "https://[::ffff:7f00:1]/hook",
      "https://[::127.0.0.1]/hook",
      "https://[::7f00:1]/hook",
      "https://localhost./hook",
      "https://metadata.google.internal./",
      "https://198.18.0.1/hook",
      "https://224.0.0.1/hook",
      "https://240.0.0.1/hook",
      "https://192.0.2.1/hook",
      "https://[fec0::1]/hook",
      "https://[ff02::1]/hook",
      "https://[::ffff:198.18.0.1]/hook",
      "https://[::ffff:224.0.0.1]/hook",
      "https://[2001:db8::1]/hook",
      "https://[100::1]/hook",
      "https://[2001:2::1]/hook",
      "https://[3fff::1]/hook",
      "https://[64:ff9b::c0a8:1]/hook",
      "https://[64:ff9b:1::c0a8:1]/hook",
      "https://[5f00::1]/hook",
      "https://[100:0:0:1::1]/hook",
    ]) {
      expect(() => assertPublicHttpsWebhookUrl(url)).toThrow(WebhookUrlError);
    }
  });

  it("accepts a public IPv6 literal", () => {
    expect(
      assertPublicHttpsWebhookUrl("https://[2001:4860:4860::8888]/hook")
        .hostname,
    ).toBe("[2001:4860:4860::8888]");
  });
});

describe("webhook admin API", () => {
  it("rejects a public hostname whose resolved address is metadata", async () => {
    const cookie = await devLogin("admin");
    const response = await SELF.fetch(`${BASE}/admin/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Resolved metadata",
        url: "https://private.example/hook",
      }),
    });
    expect(response.status).toBe(400);
  });
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

  it("rejects a private webhook URL on create and replace", async () => {
    const cookie = await devLogin("admin");
    const created = await SELF.fetch(`${BASE}/admin/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Metadata",
        url: "https://169.254.169.254/latest/meta-data",
      }),
    });
    expect(created.status).toBe(400);

    const allowed = await SELF.fetch(`${BASE}/admin/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Replace me",
        url: "https://example.com/before",
      }),
    });
    expect(allowed.status).toBe(201);
    const { created: id } = await allowed.json<{ created: string }>();
    await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: false }),
    });
    const db = drizzle(env.DB);
    const before = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, id))
      .get();

    const rejected = await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: "http://127.0.0.1/hook" }),
    });
    expect(rejected.status).toBe(400);

    const replaced = await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: "https://example.com/after" }),
    });
    expect(replaced.status).toBe(200);
    const after = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, id))
      .get();
    expect(after?.url).toBe("https://example.com/after");
    expect(after?.cursor).toBe(before?.cursor);

    await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
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

  it.each([
    {
      url: "http://legacy.example/hook",
      target: "https://final.example/hook",
      blocked: false,
      redirects: 1,
    },
    {
      url: "https://legacy.example/hook",
      target: "http://final.example/hook",
      blocked: false,
      redirects: 1,
    },
    {
      url: "https://legacy.example/hook",
      target: "https://private.example/hook",
      blocked: true,
      redirects: 1,
    },
    {
      url: "https://legacy.example/long-chain",
      target: "https://final.example/hook",
      blocked: false,
      redirects: 6,
    },
  ])(
    "keeps checked legacy delivery for $url to $target",
    async ({ url, target, blocked, redirects }) => {
      const db = drizzle(env.DB);
      const tail = await db
        .select({ rowid: sql<number>`coalesce(max(rowid), 0)` })
        .from(changeLog)
        .get();
      const cursor = tail?.rowid ?? 0;
      const hookId = crypto.randomUUID();
      const entryId = crypto.randomUUID();
      await db.insert(webhooks).values({
        id: hookId,
        name: "Legacy",
        url,
        cursor,
        createdAt: new Date(),
      });
      await db.insert(changeLog).values({
        id: entryId,
        actorUserId: "test",
        actorName: "test",
        action: "flag.update",
        target: "test",
        createdAt: new Date(),
      });
      const calls: string[] = [];
      const subscriber = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return calls.length <= redirects
          ? new Response(null, { status: 307, headers: { location: target } })
          : new Response("ok");
      }) as typeof fetch;
      try {
        await drainWebhooks(db, subscriber);
        const row = await db
          .select()
          .from(webhooks)
          .where(eq(webhooks.id, hookId))
          .get();
        expect(calls).toEqual(
          blocked
            ? [url]
            : [url, ...Array.from({ length: redirects }, () => target)],
        );
        expect(row?.lastStatus).toBe(blocked ? "blocked" : "ok");
        expect(row?.cursor).toBe(blocked ? cursor : cursor + 1);
        const cookie = await devLogin("admin");
        const listed = await SELF.fetch(`${BASE}/admin/webhooks`, {
          headers: { cookie },
        });
        const result = await listed.json<{
          webhooks: { id: string; warnings: string[] }[];
        }>();
        expect(
          result.webhooks.find((hook) => hook.id === hookId)?.warnings,
        ).toHaveLength(1);
      } finally {
        await db.delete(webhooks).where(eq(webhooks.id, hookId));
        await db.delete(changeLog).where(eq(changeLog.id, entryId));
      }
    },
  );

  it("rechecks DNS before delivery and retains the cursor when a hostname turns private", async () => {
    const db = drizzle(env.DB);
    const tail = await db
      .select({ rowid: sql<number>`coalesce(max(rowid), 0)` })
      .from(changeLog)
      .get();
    const cursor = tail?.rowid ?? 0;
    const hookId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    await db.insert(webhooks).values({
      id: hookId,
      name: "Rebound",
      url: "https://private.example/hook",
      strictDelivery: true,
      cursor,
      createdAt: new Date(),
    });
    await db.insert(changeLog).values({
      id: entryId,
      actorUserId: "test",
      actorName: "test",
      action: "flag.update",
      target: "test",
      createdAt: new Date(),
    });
    let calls = 0;
    try {
      await drainWebhooks(db, (async () => {
        calls++;
        return new Response("ok");
      }) as typeof fetch);
      const row = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, hookId))
        .get();
      expect(calls).toBe(0);
      expect(row?.cursor).toBe(cursor);
      expect(row?.lastStatus).toBe("blocked");
    } finally {
      await db.delete(webhooks).where(eq(webhooks.id, hookId));
      await db.delete(changeLog).where(eq(changeLog.id, entryId));
    }
  });

  it("stops an old legacy drain when the same URL is migrated to strict delivery", async () => {
    const db = drizzle(env.DB);
    const tail = await db
      .select({ rowid: sql<number>`coalesce(max(rowid), 0)` })
      .from(changeLog)
      .get();
    const cursor = tail?.rowid ?? 0;
    const hookId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const url = "https://legacy.example/hook";
    await db.insert(webhooks).values({
      id: hookId,
      name: "Legacy",
      url,
      cursor,
      createdAt: new Date(),
    });
    await db.insert(changeLog).values({
      id: entryId,
      actorUserId: "test",
      actorName: "test",
      action: "flag.update",
      target: "test",
      createdAt: new Date(),
    });
    const calls: string[] = [];
    try {
      await drainWebhooks(db, (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (calls.length === 1)
          await setWebhookUrl(db, {
            id: hookId,
            url,
            actor: { id: "test", name: "Test" },
          });
        return new Response(null, {
          status: 307,
          headers: { location: "https://next.example/hook" },
        });
      }) as typeof fetch);
      const row = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, hookId))
        .get();
      expect(calls).toEqual([url]);
      expect(row?.strictDelivery).toBe(true);
      expect(row?.lastStatus).toBeNull();
      expect(row?.cursor).toBe(cursor);
    } finally {
      await db.delete(webhooks).where(eq(webhooks.id, hookId));
      await db.delete(changeLog).where(eq(changeLog.id, entryId));
    }
  });

  it("does not POST a stored private URL or advance its cursor", async () => {
    const db = drizzle(env.DB);
    const tail = await db
      .select({ rowid: sql<number>`coalesce(max(rowid), 0)` })
      .from(changeLog)
      .get();
    const hookId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const cursor = tail?.rowid ?? 0;
    await db.insert(webhooks).values({
      id: hookId,
      name: "Legacy metadata",
      url: "https://169.254.169.254/latest/meta-data",
      cursor,
      createdAt: new Date(),
    });
    await db.insert(changeLog).values({
      id: entryId,
      actorUserId: "blocked-test",
      actorName: "Blocked test",
      action: "flag.update",
      target: "blocked-test",
      createdAt: new Date(),
    });
    try {
      const posts: string[] = [];
      const fakeFetch = (async (input: RequestInfo | URL) => {
        posts.push(String(input));
        return new Response("ok");
      }) as typeof fetch;
      await drainWebhooks(db, fakeFetch);
      expect(posts).toEqual([]);
      const row = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, hookId))
        .get();
      expect(row?.cursor).toBe(cursor);
      expect(row?.lastStatus).toBe("blocked");
    } finally {
      await db.delete(webhooks).where(eq(webhooks.id, hookId));
      await db.delete(changeLog).where(eq(changeLog.id, entryId));
    }
  });

  it("does not follow a redirect and does not commit a replaced URL", async () => {
    const db = drizzle(env.DB);
    const tail = await db
      .select({ rowid: sql<number>`coalesce(max(rowid), 0)` })
      .from(changeLog)
      .get();
    const hookId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const cursor = tail?.rowid ?? 0;
    const oldUrl = "https://old.example/hook";
    const newUrl = "https://new.example/hook";
    await db.insert(webhooks).values({
      id: hookId,
      name: "Replace during drain",
      url: oldUrl,
      cursor,
      createdAt: new Date(),
    });
    await db.insert(changeLog).values({
      id: entryId,
      actorUserId: "race-test",
      actorName: "Race test",
      action: "flag.update",
      target: "race-test",
      createdAt: new Date(),
    });
    try {
      const calls: { url: string; redirect: RequestRedirect | undefined }[] =
        [];
      const racingFetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        calls.push({ url: String(input), redirect: init?.redirect });
        await db
          .update(webhooks)
          .set({ url: newUrl })
          .where(eq(webhooks.id, hookId));
        return new Response(null, {
          status: 307,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        });
      }) as typeof fetch;
      await drainWebhooks(db, racingFetch);
      expect(calls).toEqual([{ url: oldUrl, redirect: "manual" }]);
      const replaced = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, hookId))
        .get();
      expect(replaced?.url).toBe(newUrl);
      expect(replaced?.cursor).toBe(cursor);

      calls.length = 0;
      const followUp = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        calls.push({ url: String(input), redirect: init?.redirect });
        return new Response("ok");
      }) as typeof fetch;
      await drainWebhooks(db, followUp);
      expect(calls).toEqual([{ url: newUrl, redirect: "manual" }]);
      const delivered = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, hookId))
        .get();
      expect(delivered?.cursor).toBeGreaterThan(cursor);
      expect(delivered?.lastStatus).toBe("ok");
    } finally {
      await db.delete(webhooks).where(eq(webhooks.id, hookId));
      await db.delete(changeLog).where(eq(changeLog.id, entryId));
    }
  });

  it("records a redirect and does not request the Location target", async () => {
    const db = drizzle(env.DB);
    const tail = await db
      .select({ rowid: sql<number>`coalesce(max(rowid), 0)` })
      .from(changeLog)
      .get();
    const hookId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const cursor = tail?.rowid ?? 0;
    await db.insert(webhooks).values({
      id: hookId,
      name: "Redirect",
      strictDelivery: true,
      url: "https://redirect.example/hook",
      cursor,
      createdAt: new Date(),
    });
    await db.insert(changeLog).values({
      id: entryId,
      actorUserId: "redirect-test",
      actorName: "Redirect test",
      action: "flag.update",
      target: "redirect-test",
      createdAt: new Date(),
    });
    try {
      const calls: string[] = [];
      const fakeFetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        calls.push(String(input));
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 307,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        });
      }) as typeof fetch;
      await drainWebhooks(db, fakeFetch);
      expect(calls).toEqual(["https://redirect.example/hook"]);
      const row = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, hookId))
        .get();
      expect(row?.lastStatus).toBe("redirect");
      expect(row?.cursor).toBeGreaterThan(cursor);
    } finally {
      await db.delete(webhooks).where(eq(webhooks.id, hookId));
      await db.delete(changeLog).where(eq(changeLog.id, entryId));
    }
  });

  it("keeps a completed POST when the same URL is disabled during delivery", async () => {
    const db = drizzle(env.DB);
    const tail = await db
      .select({ rowid: sql<number>`coalesce(max(rowid), 0)` })
      .from(changeLog)
      .get();
    const hookId = crypto.randomUUID();
    const entryIds = [crypto.randomUUID(), crypto.randomUUID()];
    const cursor = tail?.rowid ?? 0;
    const url = "https://disable.example/hook";
    await db.insert(webhooks).values({
      id: hookId,
      name: "Disable during drain",
      url,
      cursor,
      createdAt: new Date(),
    });
    await db.insert(changeLog).values(
      entryIds.map((id) => ({
        id,
        actorUserId: "disable-test",
        actorName: "Disable test",
        action: "flag.update" as const,
        target: "disable-test",
        createdAt: new Date(),
      })),
    );
    try {
      const calls: string[] = [];
      const disablingFetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        await db
          .update(webhooks)
          .set({ enabled: false })
          .where(eq(webhooks.id, hookId));
        return new Response("ok");
      }) as typeof fetch;
      await drainWebhooks(db, disablingFetch);
      expect(calls).toEqual([url]);
      const paused = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, hookId))
        .get();
      expect(paused?.enabled).toBe(false);
      expect(paused?.cursor).toBeGreaterThan(cursor);
      const advanced = paused?.cursor ?? cursor;

      await db
        .update(webhooks)
        .set({ enabled: true })
        .where(eq(webhooks.id, hookId));
      calls.length = 0;
      const resumed = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response("ok");
      }) as typeof fetch;
      await drainWebhooks(db, resumed);
      expect(calls).toEqual([url]);
      const done = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, hookId))
        .get();
      expect(done?.cursor).toBeGreaterThan(advanced);
    } finally {
      await db.delete(webhooks).where(eq(webhooks.id, hookId));
      await db.delete(changeLog).where(inArray(changeLog.id, entryIds));
    }
  });
});
