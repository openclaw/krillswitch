import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import {
  assertPublicHttpsWebhookUrl,
  drainWebhooks,
  resolvePublicWebhookAddresses,
  WebhookUrlError,
} from "../src/admin/webhooks";
import { webhooks } from "../src/db/schema";

const BASE = "http://localhost";
const DOH = "https://cloudflare-dns.com/dns-query";
const PUBLIC_V4 = "93.184.216.34";

function dohAnswer(name: string, data: string, type = 1): Response {
  return new Response(
    JSON.stringify({
      Status: 0,
      Answer: [{ name, type, TTL: 60, data }],
    }),
    { headers: { "content-type": "application/dns-json" } },
  );
}

function isDoh(url: string): boolean {
  return url.startsWith(DOH);
}

function dohName(url: string): string {
  return new URL(url).searchParams.get("name") ?? "";
}

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

describe("resolvePublicWebhookAddresses", () => {
  it("fails closed when any DoH answer is private", async () => {
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("type=AAAA")) {
        return dohAnswer(dohName(url), "::1", 28);
      }
      return dohAnswer(dohName(url), PUBLIC_V4);
    }) as typeof fetch;
    await expect(
      resolvePublicWebhookAddresses("https://mixed.example/hook", fakeFetch),
    ).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it("fails closed when DoH returns benchmark, multicast, or reserved IPv4", async () => {
    for (const data of ["198.18.0.1", "224.0.0.1", "240.0.0.1"]) {
      const fakeFetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("type=AAAA")) {
          return new Response(JSON.stringify({ Status: 0, Answer: [] }), {
            headers: { "content-type": "application/dns-json" },
          });
        }
        return dohAnswer(dohName(url), data);
      }) as typeof fetch;
      await expect(
        resolvePublicWebhookAddresses(
          "https://nonglobal.example/hook",
          fakeFetch,
        ),
        data,
      ).rejects.toBeInstanceOf(WebhookUrlError);
    }
  });

  it("fails closed when DoH returns site-local or multicast IPv6", async () => {
    for (const data of [
      "fec0::1",
      "ff02::1",
      "2001:2::1",
      "3fff::1",
      "64:ff9b::c0a8:1",
      "5f00::1",
    ]) {
      const fakeFetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("type=AAAA")) {
          return dohAnswer(dohName(url), data, 28);
        }
        return dohAnswer(dohName(url), PUBLIC_V4);
      }) as typeof fetch;
      await expect(
        resolvePublicWebhookAddresses(
          "https://nonglobal6.example/hook",
          fakeFetch,
        ),
        data,
      ).rejects.toBeInstanceOf(WebhookUrlError);
    }
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

  it("admin cannot create non-global IPv4 or IPv6 webhook targets", async () => {
    const cookie = await devLogin("admin");
    for (const url of [
      "https://198.18.0.1/hook",
      "https://224.0.0.1/hook",
      "https://240.0.0.1/hook",
      "https://[fec0::1]/hook",
      "https://[ff02::1]/hook",
    ]) {
      const created = await SELF.fetch(`${BASE}/admin/webhooks`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Non-global", url }),
      });
      expect(created.status, url).toBe(400);
    }
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
      const url = String(input);
      if (isDoh(url)) {
        return dohAnswer(dohName(url), PUBLIC_V4);
      }
      posts.push({ url, body: String(init?.body) });
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
      expect(row?.cursor).toBe(0);
    }
  });

  it("does not POST when DNS resolves to a private address", async () => {
    const cookie = await devLogin("admin");
    const created = await SELF.fetch(`${BASE}/admin/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Rebind trap",
        url: "https://evil-private.example/hook",
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
          comment: "dns private destination",
        }),
      },
    );

    const invoked: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      invoked.push(url);
      if (isDoh(url)) {
        return dohAnswer(dohName(url), "169.254.169.254");
      }
      return new Response("should-not-post", { status: 200 });
    }) as typeof fetch;

    const db = drizzle(env.DB);
    const before = (await db.select().from(webhooks).all()).find(
      (entry) => entry.id === id,
    );
    await drainWebhooks(db, fakeFetch);
    expect(
      invoked.some((url) => url.includes("evil-private.example/hook")),
    ).toBe(false);
    const after = (await db.select().from(webhooks).all()).find(
      (entry) => entry.id === id,
    );
    expect(after?.lastStatus).toBe("blocked");
    expect(after?.cursor).toBe(before?.cursor);

    await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
  });

  it("keeps pending entries when a stored hook is blocked then URL is patched", async () => {
    const cookie = await devLogin("admin");
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          enabled: true,
          comment: "legacy hook pending",
        }),
      },
    );

    const db = drizzle(env.DB);
    const id = crypto.randomUUID();
    await db.insert(webhooks).values({
      id,
      name: "Legacy HTTP",
      url: "http://hooks.example/old",
      enabled: true,
      cursor: 0,
      createdAt: new Date(),
    });

    const firstInvoked: string[] = [];
    await drainWebhooks(db, (async (input: RequestInfo | URL) => {
      firstInvoked.push(String(input));
      return new Response("ok", { status: 200 });
    }) as typeof fetch);
    expect(firstInvoked.some((url) => url.includes("hooks.example"))).toBe(
      false,
    );
    const blocked = (await db.select().from(webhooks).all()).find(
      (entry) => entry.id === id,
    );
    expect(blocked?.lastStatus).toBe("blocked");
    expect(blocked?.cursor).toBe(0);

    const patched = await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: "https://hooks.example/new" }),
    });
    expect(patched.status).toBe(200);

    const posts: string[] = [];
    await drainWebhooks(db, (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isDoh(url)) {
        return dohAnswer(dohName(url), PUBLIC_V4);
      }
      posts.push(url);
      return new Response("ok", { status: 200 });
    }) as typeof fetch);
    expect(posts.some((url) => url === "https://hooks.example/new")).toBe(true);
    const delivered = (await db.select().from(webhooks).all()).find(
      (entry) => entry.id === id,
    );
    expect(delivered?.cursor).toBeGreaterThan(0);

    await SELF.fetch(`${BASE}/admin/webhooks/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
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
      if (isDoh(url)) {
        return dohAnswer(dohName(url), PUBLIC_V4);
      }
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
