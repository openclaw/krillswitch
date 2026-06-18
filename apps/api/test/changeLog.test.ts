import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";

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

function jsonInit(cookie: string, method: string, body?: unknown) {
  return {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

type LogEntry = {
  id: string;
  actorName: string;
  action: string;
  projectKey: string | null;
  flagKey: string | null;
  target: string;
  before: unknown;
  after: unknown;
};

async function fetchLog(cookie: string, query = ""): Promise<LogEntry[]> {
  const response = await SELF.fetch(`${BASE}/admin/changelog${query}`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return (await response.json<{ entries: LogEntry[] }>()).entries;
}

describe("change log writes", () => {
  it("records every mutation type with actor and before/after", async () => {
    const editor = await devLogin("editor");
    const admin = await devLogin("admin");

    // flag.toggle
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      jsonInit(editor, "PATCH", { enabled: false }),
    );
    // flag.update (re-enable through the full editor)
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      jsonInit(editor, "PUT", {
        enabled: true,
        variations: [
          { id: "var_souls_on", value: true, name: "On" },
          { id: "var_souls_off", value: false, name: "Off" },
        ],
        offVariationIndex: 1,
        defaultVariationIndex: 0,
        targets: [],
        rules: [],
        rollout: null,
      }),
    );
    // flag.create + flag.delete
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/flags`,
      jsonInit(editor, "POST", {
        key: "log-fixture",
        name: "Log fixture",
        kind: "boolean",
        variations: [{ value: true }, { value: false }],
        defaultVariationIndex: 0,
        offVariationIndex: 1,
        enabled: false,
      }),
    );
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/flags/log-fixture`,
      jsonInit(admin, "DELETE"),
    );
    // project.create + environment.create + key.rotate
    await SELF.fetch(
      `${BASE}/admin/projects`,
      jsonInit(admin, "POST", { key: "logproj", name: "Log Project" }),
    );
    await SELF.fetch(
      `${BASE}/admin/projects/logproj/environments`,
      jsonInit(admin, "POST", { key: "dev", name: "Dev" }),
    );
    await SELF.fetch(
      `${BASE}/admin/projects/logproj/environments/dev/keys/rotate`,
      jsonInit(admin, "POST"),
    );
    // role.set
    const users = await (
      await SELF.fetch(`${BASE}/admin/users`, { headers: { cookie: admin } })
    ).json<{ users: { id: string; name: string; role: string | null }[] }>();
    const editorUser = users.users.find((user) => user.name === "Dev Editor");
    await SELF.fetch(
      `${BASE}/admin/users/${editorUser?.id}/role`,
      jsonInit(admin, "PUT", { role: "editor" }),
    );

    const entries = await fetchLog(admin);
    const actions = entries.map((entry) => entry.action);
    for (const expected of [
      "flag.toggle",
      "flag.update",
      "flag.create",
      "flag.delete",
      "project.create",
      "environment.create",
      "key.rotate",
      "role.set",
    ]) {
      expect(actions).toContain(expected);
    }

    const toggle = entries.find((entry) => entry.action === "flag.toggle");
    expect(toggle).toMatchObject({
      actorName: "Dev Editor",
      projectKey: "clawhub",
      flagKey: "souls",
      before: { enabled: true },
      after: { enabled: false },
    });

    const rotate = entries.find((entry) => entry.action === "key.rotate");
    expect(rotate?.actorName).toBe("Dev Admin");
    expect(rotate?.before).toHaveProperty("evalKey");
    expect(rotate?.after).toHaveProperty("evalKey");
  });

  it("writes nothing for rejected mutations", async () => {
    const viewer = await devLogin("viewer");
    const editor = await devLogin("editor");
    const admin = await devLogin("admin");
    const countBefore = (await fetchLog(admin)).length;

    // Authorization failure.
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      jsonInit(viewer, "PATCH", { enabled: false }),
    );
    // Validation failure (weights don't sum).
    await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/souls`,
      jsonInit(editor, "PUT", {
        enabled: true,
        variations: [
          { id: "var_souls_on", value: true },
          { id: "var_souls_off", value: false },
        ],
        offVariationIndex: 1,
        defaultVariationIndex: 0,
        targets: [],
        rules: [],
        rollout: {
          variations: [
            { variationIndex: 0, weight: 60 },
            { variationIndex: 1, weight: 50 },
          ],
        },
      }),
    );

    expect((await fetchLog(admin)).length).toBe(countBefore);
  });

  it("filters by flag key", async () => {
    const admin = await devLogin("admin");
    const entries = await fetchLog(admin, "?flagKey=souls");
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.flagKey).toBe("souls");
    }
  });

  it("is immutable through the API", async () => {
    const admin = await devLogin("admin");
    const entries = await fetchLog(admin);
    const first = entries[0];
    const update = await SELF.fetch(
      `${BASE}/admin/changelog/${first?.id}`,
      jsonInit(admin, "PUT", { action: "tampered" }),
    );
    expect(update.status).toBe(404);
    const remove = await SELF.fetch(`${BASE}/admin/changelog/${first?.id}`, {
      method: "DELETE",
      headers: { cookie: admin },
    });
    expect(remove.status).toBe(404);
  });

  it("filters audit history by actor for a member profile", async () => {
    const admin = await devLogin("admin");
    const me = await (
      await SELF.fetch(`${BASE}/admin/me`, { headers: { cookie: admin } })
    ).json<{ user: { id: string } }>();

    const mine = await (
      await SELF.fetch(`${BASE}/admin/users/${me.user.id}/changelog`, {
        headers: { cookie: admin },
      })
    ).json<{ entries: LogEntry[]; total: number }>();
    expect(mine.total).toBeGreaterThan(0);

    // A member with no recorded actions has an empty history.
    const empty = await (
      await SELF.fetch(`${BASE}/admin/users/nobody/changelog`, {
        headers: { cookie: admin },
      })
    ).json<{ entries: LogEntry[]; total: number }>();
    expect(empty.total).toBe(0);
  });

  it("scopes a member's audit history to admins", async () => {
    const viewer = await devLogin("viewer");
    const response = await SELF.fetch(`${BASE}/admin/users/anyone/changelog`, {
      headers: { cookie: viewer },
    });
    expect(response.status).toBe(403);
  });

  it("is readable by viewers", async () => {
    const viewer = await devLogin("viewer");
    const entries = await fetchLog(viewer);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("returns a single entry by id with its full target and before/after", async () => {
    const admin = await devLogin("admin");
    const entries = await fetchLog(admin);
    const first = entries[0];
    const response = await SELF.fetch(`${BASE}/admin/changelog/${first?.id}`, {
      headers: { cookie: admin },
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ entry: LogEntry }>();
    expect(body.entry.id).toBe(first?.id);
    expect(body.entry.target).toBe(first?.target);
    expect(body.entry.action).toBe(first?.action);
  });

  it("404s for an unknown entry id", async () => {
    const admin = await devLogin("admin");
    const response = await SELF.fetch(
      `${BASE}/admin/changelog/chg_does_not_exist`,
      { headers: { cookie: admin } },
    );
    expect(response.status).toBe(404);
  });

  it("paginates with limit/offset and reports a stable total", async () => {
    const admin = await devLogin("admin");
    const page1 = await (
      await SELF.fetch(`${BASE}/admin/changelog?limit=2&offset=0`, {
        headers: { cookie: admin },
      })
    ).json<{ entries: LogEntry[]; total: number }>();
    expect(page1.entries.length).toBe(2);
    expect(page1.total).toBeGreaterThan(2);

    const page2 = await (
      await SELF.fetch(`${BASE}/admin/changelog?limit=2&offset=2`, {
        headers: { cookie: admin },
      })
    ).json<{ entries: LogEntry[]; total: number }>();
    expect(page2.total).toBe(page1.total);
    // Next page is a different slice — no overlap with the first.
    const firstIds = new Set(page1.entries.map((entry) => entry.id));
    expect(page2.entries.some((entry) => firstIds.has(entry.id))).toBe(false);
  });
});
