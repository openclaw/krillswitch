import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import { clearConfigCache } from "../src/configCache";

const BASE = "http://localhost";
const DEV_EVAL_KEY = "ks_clawhub_development_local";

beforeAll(async () => {
  const statements = seedSql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

beforeEach(async () => {
  clearConfigCache();
  await env.DB.prepare(
    "UPDATE flag_environments SET enabled = 1 WHERE id = 'fe_souls_dev'",
  ).run();
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

async function mintToken(
  cookie: string,
  body: { name: string; role: "editor" | "viewer" },
): Promise<Response> {
  return SELF.fetch(`${BASE}/admin/tokens`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("token management is admin-only", () => {
  it("rejects editors and viewers from minting and listing", async () => {
    const editor = await devLogin("editor");
    const viewer = await devLogin("viewer");
    expect(
      (await mintToken(editor, { name: "x", role: "editor" })).status,
    ).toBe(403);
    expect(
      (
        await SELF.fetch(`${BASE}/admin/tokens`, {
          headers: { cookie: viewer },
        })
      ).status,
    ).toBe(403);
  });

  it("refuses to mint an admin-role token", async () => {
    const admin = await devLogin("admin");
    const response = await SELF.fetch(`${BASE}/admin/tokens`, {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify({ name: "nope", role: "admin" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("token lifecycle and bearer auth", () => {
  it("mints once, shows plaintext once, and stores only a hash", async () => {
    const admin = await devLogin("admin");
    const minted = await mintToken(admin, {
      name: "agent-editor",
      role: "editor",
    });
    expect(minted.status).toBe(201);
    const { token, id } = await minted.json<{ token: string; id: string }>();
    expect(token).toMatch(/^ksat_/);

    // The list never returns the plaintext or a hash.
    const list = await SELF.fetch(`${BASE}/admin/tokens`, {
      headers: { cookie: admin },
    });
    const body = await list.json<{
      tokens: {
        id: string;
        name: string;
        role: string;
        revokedAt: number | null;
      }[];
    }>();
    const row = body.tokens.find((entry) => entry.id === id);
    expect(row).toMatchObject({ name: "agent-editor", role: "editor" });
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it("authenticates an editor token to toggle and attributes the change log to the token name", async () => {
    const admin = await devLogin("admin");
    const { token } = await (
      await mintToken(admin, { name: "ci-deployer", role: "editor" })
    ).json<{ token: string }>();

    const toggle = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      {
        method: "PATCH",
        headers: { ...bearer(token), "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(toggle.status).toBe(200);

    const log = await SELF.fetch(`${BASE}/admin/changelog?flagKey=souls`, {
      headers: { cookie: admin },
    });
    const entries = await log.json<{
      entries: { actorName: string; action: string }[];
    }>();
    const toggleEntry = entries.entries.find(
      (entry) => entry.action === "flag.toggle",
    );
    expect(toggleEntry?.actorName).toBe("ci-deployer");
  });

  it("lets a viewer token read but refuses every mutation", async () => {
    const admin = await devLogin("admin");
    const { token } = await (
      await mintToken(admin, { name: "readonly", role: "viewer" })
    ).json<{ token: string }>();

    const read = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags`,
      { headers: bearer(token) },
    );
    expect(read.status).toBe(200);

    const toggle = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      {
        method: "PATCH",
        headers: { ...bearer(token), "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(toggle.status).toBe(403);
  });

  it("denies tokens on admin-only routes", async () => {
    const admin = await devLogin("admin");
    const { token } = await (
      await mintToken(admin, { name: "editor-token", role: "editor" })
    ).json<{ token: string }>();
    const response = await SELF.fetch(`${BASE}/admin/users`, {
      headers: bearer(token),
    });
    expect(response.status).toBe(403);
  });

  it("401s a revoked token", async () => {
    const admin = await devLogin("admin");
    const minted = await (
      await mintToken(admin, { name: "short-lived", role: "viewer" })
    ).json<{ token: string; id: string }>();

    expect(
      (await SELF.fetch(`${BASE}/admin/me`, { headers: bearer(minted.token) }))
        .status,
    ).toBe(200);

    const revoke = await SELF.fetch(
      `${BASE}/admin/tokens/${minted.id}/revoke`,
      { method: "POST", headers: { cookie: admin } },
    );
    expect(revoke.status).toBe(200);

    expect(
      (await SELF.fetch(`${BASE}/admin/me`, { headers: bearer(minted.token) }))
        .status,
    ).toBe(401);
  });

  it("401s a malformed or unknown token", async () => {
    expect(
      (
        await SELF.fetch(`${BASE}/admin/me`, {
          headers: bearer("ksat_not-a-real-token"),
        })
      ).status,
    ).toBe(401);
  });

  it("reports the token identity and role on /me", async () => {
    const admin = await devLogin("admin");
    const { token } = await (
      await mintToken(admin, { name: "whoami", role: "viewer" })
    ).json<{ token: string }>();
    const me = await SELF.fetch(`${BASE}/admin/me`, { headers: bearer(token) });
    const body = await me.json<{ user: { name: string }; role: string }>();
    expect(body.user.name).toBe("whoami");
    expect(body.role).toBe("viewer");
  });
});

// Eval keys (ks_) must not be mistaken for access tokens (ksat_).
describe("token auth ignores eval keys", () => {
  it("does not authenticate an admin request with an eval key", async () => {
    const response = await SELF.fetch(`${BASE}/admin/me`, {
      headers: bearer(DEV_EVAL_KEY),
    });
    expect(response.status).toBe(401);
  });
});
