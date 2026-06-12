import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import { clearConfigCache } from "../src/configCache";

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

async function me(cookie: string) {
  const response = await SELF.fetch(`${BASE}/admin/me`, {
    headers: { cookie },
  });
  return response.json<{ user: { id: string }; role: string | null }>();
}

function jsonInit(cookie: string, method: string, body?: unknown) {
  return {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

describe("role grant management", () => {
  it("locks the users list to admins", async () => {
    const editor = await devLogin("editor");
    const viewer = await devLogin("viewer");
    const admin = await devLogin("admin");
    expect(
      (await SELF.fetch(`${BASE}/admin/users`, { headers: { cookie: editor } }))
        .status,
    ).toBe(403);
    expect(
      (await SELF.fetch(`${BASE}/admin/users`, { headers: { cookie: viewer } }))
        .status,
    ).toBe(403);
    const response = await SELF.fetch(`${BASE}/admin/users`, {
      headers: { cookie: admin },
    });
    expect(response.status).toBe(200);
    const body = await response.json<{
      users: { email: string; role: string | null }[];
    }>();
    expect(body.users.length).toBeGreaterThanOrEqual(3);
  });

  it("grants editor to the nogrant persona, revokes it, and the revocation survives re-login", async () => {
    const nogrant = await devLogin("nogrant");
    const nograntUser = (await me(nogrant)).user.id;
    expect((await me(nogrant)).role).toBeNull();

    const admin = await devLogin("admin");
    const grant = await SELF.fetch(
      `${BASE}/admin/users/${nograntUser}/role`,
      jsonInit(admin, "PUT", { role: "editor" }),
    );
    expect(grant.status).toBe(200);

    // Access applies on the next request: no new session needed.
    expect((await me(nogrant)).role).toBe("editor");
    const toggle = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      jsonInit(nogrant, "PATCH", { enabled: true }),
    );
    expect(toggle.status).toBe(200);

    const revoke = await SELF.fetch(
      `${BASE}/admin/users/${nograntUser}/role`,
      jsonInit(admin, "PUT", { role: null }),
    );
    expect(revoke.status).toBe(200);
    expect((await me(nogrant)).role).toBeNull();

    // A fresh dev-login must not silently restore the revoked grant.
    const reloggedIn = await devLogin("nogrant");
    expect((await me(reloggedIn)).role).toBeNull();
  });

  it("refuses to remove the last admin", async () => {
    const admin = await devLogin("admin");
    const adminUser = (await me(admin)).user.id;
    const response = await SELF.fetch(
      `${BASE}/admin/users/${adminUser}/role`,
      jsonInit(admin, "PUT", { role: "viewer" }),
    );
    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe("last_admin");
    expect((await me(admin)).role).toBe("admin");
  });

  it("locks role mutation to admins", async () => {
    const editor = await devLogin("editor");
    const editorUser = (await me(editor)).user.id;
    const response = await SELF.fetch(
      `${BASE}/admin/users/${editorUser}/role`,
      jsonInit(editor, "PUT", { role: "admin" }),
    );
    expect(response.status).toBe(403);
  });
});

describe("project, environment, and key management", () => {
  it("walks the create-project → create-environment → working-key path", async () => {
    const admin = await devLogin("admin");

    const project = await SELF.fetch(
      `${BASE}/admin/projects`,
      jsonInit(admin, "POST", { key: "nautilus", name: "Nautilus" }),
    );
    expect(project.status).toBe(201);

    const environment = await SELF.fetch(
      `${BASE}/admin/projects/nautilus/environments`,
      jsonInit(admin, "POST", { key: "staging", name: "Staging" }),
    );
    expect(environment.status).toBe(201);

    const keys = await SELF.fetch(`${BASE}/admin/projects/nautilus/keys`, {
      headers: { cookie: admin },
    });
    expect(keys.status).toBe(200);
    const keysBody = await keys.json<{
      keys: { environmentKey: string; evalKey: string }[];
    }>();
    const stagingKey = keysBody.keys.find(
      (entry) => entry.environmentKey === "staging",
    );
    expect(stagingKey).toBeTruthy();

    clearConfigCache();
    const evaluated = await SELF.fetch(`${BASE}/v1/eval`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${stagingKey?.evalKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ context: { key: "fresh-project-user" } }),
    });
    expect(evaluated.status).toBe(200);
    expect(await evaluated.json()).toEqual({ flags: {} });
  });

  it("backfills flag configs when a new environment joins a flagged project", async () => {
    const admin = await devLogin("admin");
    const environment = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments`,
      jsonInit(admin, "POST", { key: "staging", name: "Staging" }),
    );
    expect(environment.status).toBe(201);

    const keys = await SELF.fetch(`${BASE}/admin/projects/clawhub/keys`, {
      headers: { cookie: admin },
    });
    const keysBody = await keys.json<{
      keys: { environmentKey: string; evalKey: string }[];
    }>();
    const stagingKey = keysBody.keys.find(
      (entry) => entry.environmentKey === "staging",
    );

    clearConfigCache();
    const evaluated = await SELF.fetch(`${BASE}/v1/eval`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${stagingKey?.evalKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ context: { key: "backfill-user" } }),
    });
    const body = await evaluated.json<{
      flags: Record<string, { reason: { kind: string } }>;
    }>();
    // Existing flags exist in the new environment, safely off.
    expect(body.flags.souls?.reason.kind).toBe("off");
  });

  it("rotates an eval key: old fails, new serves", async () => {
    const admin = await devLogin("admin");
    const before = await (
      await SELF.fetch(`${BASE}/admin/projects/nautilus/keys`, {
        headers: { cookie: admin },
      })
    ).json<{ keys: { environmentKey: string; evalKey: string }[] }>();
    const oldKey = before.keys.find(
      (entry) => entry.environmentKey === "staging",
    )?.evalKey;

    const rotated = await SELF.fetch(
      `${BASE}/admin/projects/nautilus/environments/staging/keys/rotate`,
      jsonInit(admin, "POST"),
    );
    expect(rotated.status).toBe(200);
    const { evalKey: newKey } = await rotated.json<{ evalKey: string }>();
    expect(newKey).not.toBe(oldKey);

    clearConfigCache();
    const withOld = await SELF.fetch(`${BASE}/v1/eval`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${oldKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ context: { key: "rotation-user" } }),
    });
    expect(withOld.status).toBe(401);

    const withNew = await SELF.fetch(`${BASE}/v1/eval`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${newKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ context: { key: "rotation-user" } }),
    });
    expect(withNew.status).toBe(200);
  });

  it("locks every management route to admins", async () => {
    const editor = await devLogin("editor");
    const checks = [
      SELF.fetch(
        `${BASE}/admin/projects`,
        jsonInit(editor, "POST", { key: "x1", name: "X" }),
      ),
      SELF.fetch(
        `${BASE}/admin/projects/clawhub/environments`,
        jsonInit(editor, "POST", { key: "x2", name: "X" }),
      ),
      SELF.fetch(`${BASE}/admin/projects/clawhub/keys`, {
        headers: { cookie: editor },
      }),
      SELF.fetch(
        `${BASE}/admin/projects/clawhub/environments/development/keys/rotate`,
        jsonInit(editor, "POST"),
      ),
    ];
    for (const response of await Promise.all(checks)) {
      expect(response.status).toBe(403);
    }
  });

  it("rejects duplicate project and environment keys", async () => {
    const admin = await devLogin("admin");
    expect(
      (
        await SELF.fetch(
          `${BASE}/admin/projects`,
          jsonInit(admin, "POST", { key: "clawhub", name: "Dup" }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await SELF.fetch(
          `${BASE}/admin/projects/clawhub/environments`,
          jsonInit(admin, "POST", { key: "development", name: "Dup" }),
        )
      ).status,
    ).toBe(409);
  });
});
