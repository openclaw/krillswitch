import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import { clearConfigCache } from "../src/configCache";

const BASE = "http://localhost";
const DEV_EVAL_KEY = "ks_clawhub_development_local";
const DETAIL_URL = `${BASE}/admin/projects/clawhub/environments/development/flags/rollout-demo`;

beforeAll(async () => {
  const statements = seedSql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

beforeEach(() => {
  clearConfigCache();
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

async function evalFlags(contextKey: string, attributes?: object) {
  const response = await SELF.fetch(`${BASE}/v1/eval`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${DEV_EVAL_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ context: { key: contextKey, attributes } }),
  });
  return response.json<{
    flags: Record<string, { value: unknown; reason: { kind: string } }>;
  }>();
}

function putDetail(cookie: string, body: unknown, url = DETAIL_URL) {
  return SELF.fetch(url, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// rollout-demo's editable state, expressed in the index-referenced PUT shape.
function rolloutDemoDraft() {
  return {
    enabled: true,
    variations: [
      { id: "var_rollout_a", value: "a", name: "A" },
      { id: "var_rollout_b", value: "b", name: "B" },
    ],
    offVariationIndex: 0,
    defaultVariationIndex: 0,
    targets: [],
    rules: [],
    rollout: {
      variations: [
        { variationIndex: 0, weight: 50 },
        { variationIndex: 1, weight: 50 },
      ],
    },
  };
}

describe("flag detail read", () => {
  it("returns flag, variations, and environment config", async () => {
    const cookie = await devLogin("viewer");
    const response = await SELF.fetch(DETAIL_URL, { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = await response.json<{
      flag: { key: string; kind: string };
      variations: { id: string; value: unknown }[];
      config: { enabled: boolean; rollout: unknown };
    }>();
    expect(body.flag.key).toBe("rollout-demo");
    expect(body.variations).toHaveLength(2);
    expect(body.config.rollout).toBeTruthy();
  });
});

describe("flag detail update", () => {
  it("saves a 100/0 split as 50/50 and eval spreads across variations", async () => {
    const cookie = await devLogin("editor");

    // Start from a 100/0 split.
    const skewed = rolloutDemoDraft();
    skewed.rollout = {
      variations: [
        { variationIndex: 0, weight: 100 },
        { variationIndex: 1, weight: 0 },
      ],
    };
    expect((await putDetail(cookie, skewed)).status).toBe(200);
    clearConfigCache();
    const skewedValues = new Set<unknown>();
    for (let i = 0; i < 30; i++) {
      skewedValues.add(
        (await evalFlags(`spread-user-${i}`)).flags["rollout-demo"]?.value,
      );
    }
    expect(skewedValues).toEqual(new Set(["a"]));

    expect((await putDetail(cookie, rolloutDemoDraft())).status).toBe(200);
    clearConfigCache();
    const values = new Set<unknown>();
    for (let i = 0; i < 30; i++) {
      values.add(
        (await evalFlags(`spread-user-${i}`)).flags["rollout-demo"]?.value,
      );
    }
    expect(values).toEqual(new Set(["a", "b"]));
  });

  it("rejects weights that do not sum to 100", async () => {
    const cookie = await devLogin("editor");
    const draft = rolloutDemoDraft();
    draft.rollout = {
      variations: [
        { variationIndex: 0, weight: 60 },
        { variationIndex: 1, weight: 50 },
      ],
    };
    const response = await putDetail(cookie, draft);
    expect(response.status).toBe(400);
    const body = await response.json<{ error: string; message: string }>();
    expect(body.message).toMatch(/sum to 100/);
  });

  it("saves allowlist targets and attribute rules that eval honors", async () => {
    const cookie = await devLogin("editor");
    const draft = rolloutDemoDraft();
    draft.rollout = null as never;
    draft.targets = [
      { variationIndex: 1, contextKeys: ["pinned-user"] },
    ] as never;
    draft.rules = [
      { variationIndex: 1, attribute: "tier", values: ["gold"] },
    ] as never;
    expect((await putDetail(cookie, draft)).status).toBe(200);
    clearConfigCache();

    const pinned = await evalFlags("pinned-user");
    expect(pinned.flags["rollout-demo"]).toMatchObject({
      value: "b",
      reason: { kind: "target" },
    });
    const ruled = await evalFlags("someone-else", { tier: "gold" });
    expect(ruled.flags["rollout-demo"]).toMatchObject({
      value: "b",
      reason: { kind: "rule" },
    });
    const fallthrough = await evalFlags("someone-else");
    expect(fallthrough.flags["rollout-demo"]).toMatchObject({
      value: "a",
      reason: { kind: "default" },
    });
  });

  it("rejects variation values that do not match the flag kind", async () => {
    const cookie = await devLogin("editor");
    const draft = rolloutDemoDraft();
    draft.variations[0] = {
      id: "var_rollout_a",
      value: 42 as never,
      name: "A",
    };
    const response = await putDetail(cookie, draft);
    expect(response.status).toBe(400);
  });

  it("rejects viewer saves with 403", async () => {
    const cookie = await devLogin("viewer");
    expect((await putDetail(cookie, rolloutDemoDraft())).status).toBe(403);
  });

  it("refuses to delete a variation another environment still uses", async () => {
    const cookie = await devLogin("editor");
    const draft = rolloutDemoDraft();
    // Drop variation B, which production's config references as… actually
    // production references a/a; drop variation A (prod default+off).
    draft.variations = [{ id: "var_rollout_b", value: "b", name: "B" }];
    draft.offVariationIndex = 0;
    draft.defaultVariationIndex = 0;
    draft.rollout = null as never;
    const response = await putDetail(cookie, draft);
    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toBe("variation_in_use");
  });
});

describe("flag create and delete", () => {
  const createUrl = `${BASE}/admin/projects/clawhub/flags`;

  function createBody() {
    return {
      key: "banner-style",
      name: "Banner style",
      kind: "string",
      description: "Created by the 2.3 test",
      variations: [
        { value: "minimal", name: "Minimal" },
        { value: "loud", name: "Loud" },
      ],
      defaultVariationIndex: 0,
      offVariationIndex: 0,
      enabled: true,
    };
  }

  it("lets an editor create a flag that evaluates with its default", async () => {
    const cookie = await devLogin("editor");
    const response = await SELF.fetch(createUrl, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(createBody()),
    });
    expect(response.status).toBe(201);
    clearConfigCache();

    const evaluated = await evalFlags("creation-check");
    expect(evaluated.flags["banner-style"]).toMatchObject({
      value: "minimal",
      reason: { kind: "default" },
    });
  });

  it("rejects duplicate keys with 409 and viewer creates with 403", async () => {
    const editor = await devLogin("editor");
    const duplicate = await SELF.fetch(createUrl, {
      method: "POST",
      headers: { cookie: editor, "content-type": "application/json" },
      body: JSON.stringify(createBody()),
    });
    expect(duplicate.status).toBe(409);

    const viewer = await devLogin("viewer");
    const forbidden = await SELF.fetch(createUrl, {
      method: "POST",
      headers: { cookie: viewer, "content-type": "application/json" },
      body: JSON.stringify({ ...createBody(), key: "another-key" }),
    });
    expect(forbidden.status).toBe(403);
  });

  it("restricts deletion to admins and removes the flag everywhere", async () => {
    const editor = await devLogin("editor");
    const deleteUrl = `${BASE}/admin/projects/clawhub/flags/banner-style`;

    const asEditor = await SELF.fetch(deleteUrl, {
      method: "DELETE",
      headers: { cookie: editor },
    });
    expect(asEditor.status).toBe(403);

    const admin = await devLogin("admin");
    const asAdmin = await SELF.fetch(deleteUrl, {
      method: "DELETE",
      headers: { cookie: admin },
    });
    expect(asAdmin.status).toBe(200);
    clearConfigCache();

    const evaluated = await evalFlags("deletion-check");
    expect(evaluated.flags["banner-style"]).toBeUndefined();

    const list = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags`,
      { headers: { cookie: admin } },
    );
    const flags = await list.json<{ flags: { key: string }[] }>();
    expect(flags.flags.map((flag) => flag.key)).not.toContain("banner-style");
  });
});
