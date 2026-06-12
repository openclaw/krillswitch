import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import { isGitHubAuthConfigured } from "../src/auth/auth";

// localhost origin: the dev-persona guard requires a localhost request host.
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

async function devLogin(persona: string): Promise<{
  response: Response;
  cookie: string;
}> {
  const response = await SELF.fetch(`${BASE}/admin/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ persona }),
  });
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { response, cookie };
}

describe("admin session guard", () => {
  it("rejects unauthenticated /admin/me with 401", async () => {
    const response = await SELF.fetch(`${BASE}/admin/me`);
    expect(response.status).toBe(401);
  });
});

describe("auth providers", () => {
  it("offers dev personas but not GitHub when no OAuth app is configured", async () => {
    const response = await SELF.fetch(`${BASE}/admin/auth-providers`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      github: false,
      devPersonas: true,
    });
  });

  it("drops dev personas for non-localhost hosts", async () => {
    const response = await SELF.fetch(
      "https://krillswitch.test/admin/auth-providers",
    );
    const body = await response.json<{ devPersonas: boolean }>();
    expect(body.devPersonas).toBe(false);
  });

  it("treats GitHub as configured only when both credentials are set", () => {
    expect(isGitHubAuthConfigured({})).toBe(false);
    expect(isGitHubAuthConfigured({ GITHUB_CLIENT_ID: "abc" })).toBe(false);
    expect(
      isGitHubAuthConfigured({
        GITHUB_CLIENT_ID: "abc",
        GITHUB_CLIENT_SECRET: "  ",
      }),
    ).toBe(false);
    expect(
      isGitHubAuthConfigured({
        GITHUB_CLIENT_ID: "abc",
        GITHUB_CLIENT_SECRET: "shh",
      }),
    ).toBe(true);
  });
});

describe("dev persona login", () => {
  it("signs in the editor persona and /admin/me reports the editor role", async () => {
    const { response, cookie } = await devLogin("editor");
    expect(response.status).toBe(200);
    expect(cookie).toContain("better-auth");

    const me = await SELF.fetch(`${BASE}/admin/me`, {
      headers: { cookie },
    });
    expect(me.status).toBe(200);
    const body = await me.json<{
      user: { name: string; email: string };
      role: string | null;
    }>();
    expect(body.role).toBe("editor");
    expect(body.user.name).toBe("Dev Editor");
  });

  it("rejects dev-login when the request host is not localhost", async () => {
    const response = await SELF.fetch(
      "https://krillswitch.test/admin/dev-login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona: "admin" }),
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "dev_auth_disabled" });
  });

  it("rejects unknown personas", async () => {
    const { response } = await devLogin("superuser");
    expect(response.status).toBe(400);
  });
});

describe("role enforcement", () => {
  it("gives the nogrant persona a null role and rejects API calls past /admin/me", async () => {
    const { cookie } = await devLogin("nogrant");

    const me = await SELF.fetch(`${BASE}/admin/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await me.json<{ role: string | null }>()).role).toBeNull();

    const projects = await SELF.fetch(`${BASE}/admin/projects`, {
      headers: { cookie },
    });
    expect(projects.status).toBe(403);
  });

  it("lets the viewer persona read projects", async () => {
    const { cookie } = await devLogin("viewer");
    const response = await SELF.fetch(`${BASE}/admin/projects`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ projects: { key: string }[] }>();
    expect(body.projects.map((project) => project.key)).toContain("clawhub");
  });
});

describe("session lifecycle", () => {
  it("ends the session on sign-out", async () => {
    const { cookie } = await devLogin("admin");

    const before = await SELF.fetch(`${BASE}/admin/me`, {
      headers: { cookie },
    });
    expect(before.status).toBe(200);

    const signOut = await SELF.fetch(`${BASE}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin: BASE,
      },
      body: "{}",
    });
    expect(signOut.status).toBe(200);

    const after = await SELF.fetch(`${BASE}/admin/me`, {
      headers: { cookie },
    });
    expect(after.status).toBe(401);
  });
});
