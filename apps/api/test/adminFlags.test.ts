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
  // Toggle tests mutate souls; restore the seeded state.
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

type FlagListEntry = {
  key: string;
  name: string;
  kind: string;
  enabled: boolean;
};

async function fetchFlags(cookie: string): Promise<Response> {
  return SELF.fetch(
    `${BASE}/admin/projects/clawhub/environments/development/flags`,
    { headers: { cookie } },
  );
}

async function evalSouls(): Promise<boolean> {
  const response = await SELF.fetch(`${BASE}/v1/eval`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${DEV_EVAL_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ context: { key: "toggle-test-user" } }),
  });
  const body = await response.json<{
    flags: { souls: { value: boolean } };
  }>();
  return body.flags.souls.value;
}

describe("project detail", () => {
  it("returns the project with its environments", async () => {
    const cookie = await devLogin("viewer");
    const response = await SELF.fetch(`${BASE}/admin/projects/clawhub`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const body = await response.json<{
      project: { key: string };
      environments: { key: string }[];
    }>();
    expect(body.project.key).toBe("clawhub");
    expect(body.environments.map((environment) => environment.key)).toEqual([
      "development",
      "production",
    ]);
  });

  it("404s on an unknown project", async () => {
    const cookie = await devLogin("viewer");
    const response = await SELF.fetch(`${BASE}/admin/projects/nope`, {
      headers: { cookie },
    });
    expect(response.status).toBe(404);
  });
});

describe("project flag keys", () => {
  it("lists every flag in the project for the viewer persona", async () => {
    const cookie = await devLogin("viewer");
    const response = await SELF.fetch(`${BASE}/admin/projects/clawhub/flags`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ flags: { key: string }[] }>();
    expect(body.flags.map((flag) => flag.key)).toContain("souls");
    expect(body.flags.map((flag) => flag.key)).toContain("theme");
  });

  it("404s on an unknown project", async () => {
    const cookie = await devLogin("viewer");
    const response = await SELF.fetch(`${BASE}/admin/projects/nope/flags`, {
      headers: { cookie },
    });
    expect(response.status).toBe(404);
  });
});

describe("environment flag list", () => {
  it("lists flags with their per-environment enabled state", async () => {
    const cookie = await devLogin("viewer");
    const response = await fetchFlags(cookie);
    expect(response.status).toBe(200);
    const body = await response.json<{ flags: FlagListEntry[] }>();
    const souls = body.flags.find((flag) => flag.key === "souls");
    expect(souls).toMatchObject({ kind: "boolean", enabled: true });
  });

  it("carries the off variation and last-change time on each row", async () => {
    const cookie = await devLogin("editor");
    // Any change stamps the flag's lastChangedAt via the change log.
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ enabled: true }),
      },
    );
    const response = await fetchFlags(cookie);
    const body = await response.json<{
      flags: (FlagListEntry & {
        offVariation: string | null;
        lastChangedAt: string | null;
      })[];
    }>();
    const souls = body.flags.find((flag) => flag.key === "souls");
    expect(typeof souls?.offVariation).toBe("string");
    expect(souls?.lastChangedAt).toBeTruthy();
    expect(new Date(souls?.lastChangedAt ?? 0).getTime()).toBeGreaterThan(0);
  });
});

describe("flag archive", () => {
  const archiveUrl = `${BASE}/admin/projects/clawhub/flags/souls`;

  it("archives and restores, keeps serving evals, and audits both", async () => {
    const cookie = await devLogin("editor");
    const archive = await SELF.fetch(archiveUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ archived: true }),
    });
    expect(archive.status).toBe(200);

    const list = await fetchFlags(cookie);
    const body = await list.json<{
      flags: (FlagListEntry & { archived: boolean })[];
    }>();
    expect(body.flags.find((flag) => flag.key === "souls")?.archived).toBe(
      true,
    );

    // Archived flags stay in the eval payload — archiving is always safe.
    await expect(evalSouls()).resolves.toBeTypeOf("boolean");

    const restore = await SELF.fetch(archiveUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ archived: false }),
    });
    expect(restore.status).toBe(200);

    const log = await SELF.fetch(
      `${BASE}/admin/changelog?flagKey=souls&projectKey=clawhub`,
      { headers: { cookie } },
    );
    const entries = (await log.json<{ entries: { action: string }[] }>())
      .entries;
    expect(entries.some((entry) => entry.action === "flag.archive")).toBe(true);
    expect(entries.some((entry) => entry.action === "flag.restore")).toBe(true);
  });

  it("viewers cannot archive", async () => {
    const cookie = await devLogin("viewer");
    const response = await SELF.fetch(archiveUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ archived: true }),
    });
    expect(response.status).toBe(403);
  });
});

describe("flag toggle", () => {
  const toggleUrl = `${BASE}/admin/projects/clawhub/environments/development/flags/souls`;

  async function toggle(cookie: string, enabled: boolean): Promise<Response> {
    return SELF.fetch(toggleUrl, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  it("lets the editor toggle souls off and eval reflects it immediately", async () => {
    const cookie = await devLogin("editor");
    expect(await evalSouls()).toBe(true);

    const response = await toggle(cookie, false);
    expect(response.status).toBe(200);

    expect(await evalSouls()).toBe(false);

    // State comes from D1, not client state: a fresh list read agrees.
    const flags = await (await fetchFlags(cookie)).json<{
      flags: FlagListEntry[];
    }>();
    expect(flags.flags.find((flag) => flag.key === "souls")?.enabled).toBe(
      false,
    );
  });

  it("rejects a viewer toggle with 403 and leaves the flag unchanged", async () => {
    const cookie = await devLogin("viewer");
    const response = await toggle(cookie, false);
    expect(response.status).toBe(403);
    expect(await evalSouls()).toBe(true);
  });

  it("404s on an unknown flag", async () => {
    const cookie = await devLogin("editor");
    const response = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/ghost`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(response.status).toBe(404);
  });
});
