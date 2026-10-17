import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import app from "../src/index";

const BASE = "http://localhost";
const FLAG_PATH =
  "/admin/projects/oauth-proof/environments/test/flags/protected";
let serial = 0;
let identity: {
  id: number;
  email: string;
  membership: "active" | "inactive" | "unavailable";
  invalidCode: boolean;
};
let membershipRequests: number;
let unexpectedRequests: string[];
let bootstrapAdmin: boolean;

function oauthEnv() {
  return {
    ...env,
    BETTER_AUTH_URL: BASE,
    BETTER_AUTH_SECRET: "oauth-test-only-secret-not-a-real-credential",
    DEV_AUTH_ENABLED: "",
    GITHUB_CLIENT_ID: "oauth-test-client",
    GITHUB_CLIENT_SECRET: "oauth-test-secret-not-a-real-credential",
    GITHUB_VIEWER_ORG: "oauth-test-org",
    BOOTSTRAP_ADMIN_EMAIL: bootstrapAdmin ? identity.email : "",
    CLOUDFLARE_ACCESS_AUD: "",
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: "",
  };
}

async function request(path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${BASE}${path}`, init),
    oauthEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function acceptCookies(jar: Map<string, string>, response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    if (!pair) throw new Error("Missing response cookie");
    const separator = pair.indexOf("=");
    expect(separator).toBeGreaterThan(0);
    const name = pair.slice(0, separator);
    if (/max-age=0(?:;|$)/i.test(cookie)) jar.delete(name);
    else jar.set(name, pair.slice(separator + 1));
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function signIn() {
  const jar = new Map<string, string>();
  const start = await request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({
      provider: "github",
      callbackURL: `${BASE}/admin/me`,
      errorCallbackURL: `${BASE}/auth-error`,
      disableRedirect: true,
    }),
  });
  expect(start.status).toBe(200);
  acceptCookies(jar, start);
  const { url } = await start.json<{ url: string }>();
  const authorization = new URL(url);
  expect(authorization.origin).toBe("https://github.com");
  const state = authorization.searchParams.get("state");
  expect(state).toBeTruthy();
  const callback = await request(
    `/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state ?? "")}`,
    { headers: { cookie: cookieHeader(jar) } },
  );
  acceptCookies(jar, callback);
  return { callback, cookie: cookieHeader(jar) };
}

async function storedIdentity() {
  return env.DB.prepare("SELECT id, org_viewer FROM user WHERE email = ?")
    .bind(identity.email)
    .first<{ id: string; org_viewer: number }>();
}

async function storedSessionCount() {
  const row = await env.DB.prepare(
    "SELECT count(*) AS count FROM session WHERE user_id IN (SELECT id FROM user WHERE email = ?)",
  )
    .bind(identity.email)
    .first<{ count: number }>();
  return row?.count;
}

async function storedAccountCount() {
  const row = await env.DB.prepare(
    "SELECT count(*) AS count FROM account WHERE user_id IN (SELECT id FROM user WHERE email = ?)",
  )
    .bind(identity.email)
    .first<{ count: number }>();
  return row?.count;
}

async function flagState() {
  return env.DB.prepare(
    "SELECT enabled, (SELECT count(*) FROM change_log WHERE project_key = 'oauth-proof') AS changes FROM flag_environments WHERE id = 'oauth-proof-setting'",
  ).first<{ enabled: number; changes: number }>();
}

async function writeFlag(cookie: string, enabled: boolean) {
  return request(FLAG_PATH, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ enabled }),
  });
}

async function expectReadOnly(cookie: string, role: "viewer" | null) {
  const me = await request("/admin/me", { headers: { cookie } });
  expect(me.status).toBe(200);
  expect((await me.json<{ role: string | null }>()).role).toBe(role);
  const projects = await request("/admin/projects", { headers: { cookie } });
  expect(projects.status).toBe(role === "viewer" ? 200 : 403);
  const before = await flagState();
  expect((await writeFlag(cookie, !before?.enabled)).status).toBe(403);
  expect(await flagState()).toEqual(before);
}

function expectFailedCallback(response: Response) {
  const location = response.headers.get("location");
  if (location) {
    expect(response.status).toBe(302);
    expect(new URL(location, BASE).searchParams.has("error")).toBe(true);
  } else {
    expect(response.status).toBeGreaterThanOrEqual(400);
  }
  expect(
    response.headers
      .getSetCookie()
      .some(
        (cookie) =>
          cookie.includes("session_token=") &&
          !/max-age=0(?:;|$)/i.test(cookie),
      ),
  ).toBe(false);
}

async function withFailedInsert(
  table: "account" | "session",
  run: () => Promise<void>,
) {
  // A real failure in this file's local D1 database leaves the auth adapter,
  // hooks and request error handling intact. Never installed as a migration.
  await env.DB.exec(
    `CREATE TRIGGER oauth_test_failed_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'oauth test write failure'); END;`,
  );
  try {
    await run();
  } finally {
    await env.DB.exec("DROP TRIGGER oauth_test_failed_insert;");
  }
}

beforeAll(async () => {
  await env.DB.exec(`
    INSERT INTO projects (id, key, name) VALUES ('oauth-proof-project', 'oauth-proof', 'OAuth proof');
    INSERT INTO environments (id, project_id, key, name) VALUES ('oauth-proof-env', 'oauth-proof-project', 'test', 'Test');
    INSERT INTO flags (id, project_id, key, name, kind) VALUES ('oauth-proof-flag', 'oauth-proof-project', 'protected', 'Protected', 'boolean');
    INSERT INTO variations (id, flag_id, value, name, sort_order) VALUES ('oauth-proof-off', 'oauth-proof-flag', 'false', 'Off', 0);
    INSERT INTO variations (id, flag_id, value, name, sort_order) VALUES ('oauth-proof-on', 'oauth-proof-flag', 'true', 'On', 1);
    INSERT INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id) VALUES ('oauth-proof-setting', 'oauth-proof-flag', 'oauth-proof-env', 0, 'oauth-proof-off', 'oauth-proof-on');
  `);
});

beforeEach(() => {
  identity = {
    id: ++serial,
    email: `oauth-${serial}@example.com`,
    membership: "active",
    invalidCode: false,
  };
  membershipRequests = 0;
  unexpectedRequests = [];
  bootstrapAdmin = false;
  // Only provider HTTP is replaced. The Worker, OAuth state/cookies, D1,
  // account hooks, session lookup and management authorization all run normally.
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.href === "https://github.com/login/oauth/access_token") {
        expect(init?.method).toBe("POST");
        return Response.json(
          identity.invalidCode
            ? { error: "bad_verification_code" }
            : {
                access_token: "oauth-test-access-token",
                token_type: "bearer",
                scope: "read:user,user:email,read:org",
              },
        );
      }
      const apiPaths = [
        "/user",
        "/user/emails",
        "/user/memberships/orgs/oauth-test-org",
      ];
      if (
        url.origin !== "https://api.github.com" ||
        !apiPaths.includes(url.pathname)
      ) {
        unexpectedRequests.push(url.origin + url.pathname);
        throw new Error("Unexpected outbound request in OAuth test");
      }
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      expect(headers.get("authorization")).toBe(
        "Bearer oauth-test-access-token",
      );
      if (url.href === "https://api.github.com/user") {
        return Response.json({
          id: identity.id,
          login: `oauth-${identity.id}`,
          name: "OAuth Test",
          email: identity.email,
          avatar_url: null,
        });
      }
      if (url.href === "https://api.github.com/user/emails") {
        return Response.json([
          {
            email: identity.email,
            primary: true,
            verified: true,
            visibility: "private",
          },
        ]);
      }
      if (
        url.href ===
        "https://api.github.com/user/memberships/orgs/oauth-test-org"
      ) {
        membershipRequests++;
        if (identity.membership === "unavailable") {
          throw new Error("test-only provider outage");
        }
        return identity.membership === "active"
          ? Response.json({ state: "active" })
          : new Response(null, { status: 404 });
      }
      unexpectedRequests.push(url.origin + url.pathname);
      throw new Error("Unexpected outbound request in OAuth test");
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  expect(unexpectedRequests).toEqual([]);
});

describe("GitHub OAuth authority through Worker and local D1", () => {
  it("creates a member account with read-only management access", async () => {
    const { callback, cookie } = await signIn();
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${BASE}/admin/me`);
    expect(membershipRequests).toBe(1);
    expect((await storedIdentity())?.org_viewer).toBe(1);
    expect(await storedAccountCount()).toBe(1);
    expect(await storedSessionCount()).toBe(1);
    await expectReadOnly(cookie, "viewer");
  });

  it("authenticates a nonmember without granting management access", async () => {
    identity.membership = "inactive";
    const { cookie } = await signIn();
    expect(membershipRequests).toBe(1);
    expect((await storedIdentity())?.org_viewer).toBe(0);
    await expectReadOnly(cookie, null);
  });

  it("updates membership on returning sign-in, including existing sessions", async () => {
    const first = await signIn();
    identity.membership = "inactive";
    const second = await signIn();
    expect(membershipRequests).toBe(2);
    expect((await storedIdentity())?.org_viewer).toBe(0);
    await expectReadOnly(first.cookie, null);
    await expectReadOnly(second.cookie, null);
  });

  it("preserves the existing cached membership policy during a provider outage", async () => {
    await signIn();
    identity.membership = "unavailable";
    const { cookie } = await signIn();
    expect(membershipRequests).toBe(2);
    expect((await storedIdentity())?.org_viewer).toBe(1);
    await expectReadOnly(cookie, "viewer");
  });

  it("rejects a failed token exchange without account or access state", async () => {
    identity.invalidCode = true;
    const { callback, cookie } = await signIn();
    expectFailedCallback(callback);
    expect(await storedIdentity()).toBeNull();
    expect(await storedAccountCount()).toBe(0);
    expect(await storedSessionCount()).toBe(0);
    expect(membershipRequests).toBe(0);
    expect(
      (await request("/admin/projects", { headers: { cookie } })).status,
    ).toBe(401);
  });

  it("does not run the membership hook after an account insert fails", async () => {
    await withFailedInsert("account", async () => {
      const { callback, cookie } = await signIn();
      expectFailedCallback(callback);
      // D1 is nontransactional here: the user row may already be committed.
      expect((await storedIdentity())?.org_viewer).toBe(0);
      expect(await storedAccountCount()).toBe(0);
      expect(membershipRequests).toBe(0);
      expect(await storedSessionCount()).toBe(0);
      const before = await flagState();
      expect((await writeFlag(cookie, !before?.enabled)).status).toBe(401);
      expect(await flagState()).toEqual(before);
    });
  });

  it("does not issue a session after a later write fails, despite the committed hook", async () => {
    await withFailedInsert("session", async () => {
      const { callback, cookie } = await signIn();
      expectFailedCallback(callback);
      // This failure occurs after the account/hook commit, not inside the
      // transaction runner's failed-transaction hook-draining branch.
      expect(membershipRequests).toBe(1);
      expect((await storedIdentity())?.org_viewer).toBe(1);
      expect(await storedAccountCount()).toBe(1);
      expect(await storedSessionCount()).toBe(0);
      const before = await flagState();
      expect((await writeFlag(cookie, !before?.enabled)).status).toBe(401);
      expect(await flagState()).toEqual(before);
    });
  });

  it("keeps a committed membership removal when the replacement session fails", async () => {
    const first = await signIn();
    identity.membership = "inactive";
    await withFailedInsert("session", async () => {
      const { callback } = await signIn();
      expectFailedCallback(callback);
      expect(membershipRequests).toBe(2);
      expect((await storedIdentity())?.org_viewer).toBe(0);
      expect(await storedSessionCount()).toBe(1);
      await expectReadOnly(first.cookie, null);
    });
  });

  it("rejects replay of a revoked writer session before mutating D1", async () => {
    bootstrapAdmin = true;
    const { cookie } = await signIn();
    expect((await writeFlag(cookie, true)).status).toBe(200);
    const before = await flagState();
    const signOut = await request("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: BASE },
      body: "{}",
    });
    expect(signOut.status).toBe(200);
    expect(await storedSessionCount()).toBe(0);
    expect((await writeFlag(cookie, false)).status).toBe(401);
    expect(await flagState()).toEqual(before);
  });
});
