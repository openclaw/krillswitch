import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import {
  assertPublicHttpsWebhookUrl,
  drainWebhooks,
  WebhookUrlError,
} from "../src/admin/webhooks";
import { webhooks } from "../src/db/schema";

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

  it("admin cannot create a private or http webhook", async () => {
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
  });

  it("admin cannot create IPv4-compatible IPv6 or trailing-dot aliases", async () => {
    const cookie = await devLogin("admin");
    for (const url of [
      "https://[::127.0.0.1]/hook",
      "https://localhost./hook",
      "https://metadata.google.internal./hook",
    ]) {
      const created = await SELF.fetch(`${BASE}/admin/webhooks`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Alias", url }),
      });
      expect(created.status, url).toBe(400);
    }
  });

  it("admin cannot create a bracketed IPv6 loopback webhook", async () => {
    const cookie = await devLogin("admin");
    const created = await SELF.fetch(`${BASE}/admin/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "V6 loopback",
        url: "https://[::1]/hook",
      }),
    });
    expect(created.status).toBe(400);
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

  it("marks stored IPv4-compatible and trailing-dot hooks blocked", async () => {
    const cookie = await devLogin("admin");
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          enabled: true,
          comment: "stored alias drain test",
        }),
      },
    );

    const db = drizzle(env.DB);
    const aliasHooks = [
      {
        id: crypto.randomUUID(),
        name: "Legacy compatible v6",
        url: "https://[::127.0.0.1]/hook",
      },
      {
        id: crypto.randomUUID(),
        name: "Legacy trailing-dot localhost",
        url: "https://localhost./hook",
      },
    ];
    for (const hook of aliasHooks) {
      await db.insert(webhooks).values({
        ...hook,
        enabled: true,
        cursor: 0,
        createdAt: new Date(),
      });
    }

    const posts: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      posts.push(String(input));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    await drainWebhooks(db, fakeFetch);
    expect(posts.some((url) => url.includes("127.0.0.1"))).toBe(false);
    expect(posts.some((url) => url.includes("localhost"))).toBe(false);

    const rows = await db.select().from(webhooks).all();
    for (const hook of aliasHooks) {
      const row = rows.find((entry) => entry.id === hook.id);
      expect(row?.lastStatus).toBe("blocked");
    }
  });

  it("does not follow a public webhook redirect to a private target", async () => {
    const cookie = await devLogin("admin");
    const publicUrl = "https://redirect.example/hook";
    const privateUrl = "https://169.254.169.254/latest/meta-data";
    const created = await SELF.fetch(`${BASE}/admin/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Redirect trap",
        url: publicUrl,
      }),
    });
    const { created: id } = await created.json<{ created: string }>();

    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          enabled: true,
          comment: "webhook redirect trap",
        }),
      },
    );

    const invoked: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      invoked.push(url);
      const mode = init?.redirect ?? "follow";
      if (url === publicUrl && mode === "follow") {
        invoked.push(privateUrl);
        return new Response("followed", { status: 200 });
      }
      if (url === publicUrl) {
        return new Response(null, {
          status: 307,
          headers: { location: privateUrl },
        });
      }
      return new Response("private", { status: 200 });
    }) as typeof fetch;

    const db = drizzle(env.DB);
    await drainWebhooks(db, fakeFetch);
    expect(invoked.some((url) => url.includes("169.254.169.254"))).toBe(false);
    expect(invoked.filter((url) => url === publicUrl).length).toBeGreaterThan(
      0,
    );

    const row = (await db.select().from(webhooks).all()).find(
      (entry) => entry.id === id,
    );
    expect(row?.lastStatus).toBe("redirect");

    await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
  });
});
