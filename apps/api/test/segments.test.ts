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

async function evalTheme(context: {
  key: string;
  attributes?: Record<string, string>;
}): Promise<{ value: string; reason: { kind: string } }> {
  const response = await SELF.fetch(`${BASE}/v1/eval`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${DEV_EVAL_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ context }),
  });
  const body = await response.json<{
    flags: { theme: { value: string; reason: { kind: string } } };
  }>();
  return body.flags.theme;
}

describe("segments", () => {
  it("full lifecycle: create, list, use in a flag rule, evaluate, delete", async () => {
    const cookie = await devLogin("editor");

    const created = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/segments`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          key: "beta-testers",
          name: "Beta testers",
          contextKeys: ["beta-user"],
          rules: [{ attribute: "plan", values: ["beta"] }],
        }),
      },
    );
    expect(created.status).toBe(201);

    const list = await SELF.fetch(`${BASE}/admin/projects/clawhub/segments`, {
      headers: { cookie },
    });
    const listBody = await list.json<{ segments: { key: string }[] }>();
    expect(listBody.segments.map((segment) => segment.key)).toContain(
      "beta-testers",
    );

    // Point the theme flag's targeting at the segment: fetch the current
    // detail, convert to an update draft with one segment rule.
    const detailRes = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/theme`,
      { headers: { cookie } },
    );
    const detail = await detailRes.json<{
      variations: { id: string; value: unknown; name: string | null }[];
      config: {
        enabled: boolean;
        offVariationId: string;
        defaultVariationId: string;
      };
    }>();
    const ids = detail.variations.map((variation) => variation.id);
    const darkIndex = detail.variations.findIndex(
      (variation) => variation.value === "dark",
    );
    const update = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/environments/development/flags/theme`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          enabled: true,
          variations: detail.variations,
          offVariationIndex: ids.indexOf(detail.config.offVariationId),
          defaultVariationIndex: ids.indexOf(detail.config.defaultVariationId),
          targets: [],
          rules: [{ variationIndex: darkIndex, segment: "beta-testers" }],
          rollout: null,
        }),
      },
    );
    expect(update.status).toBe(200);
    clearConfigCache();

    // Segment member by pinned key, by attribute rule, and a non-member.
    expect((await evalTheme({ key: "beta-user" })).value).toBe("dark");
    expect(
      (await evalTheme({ key: "anyone", attributes: { plan: "beta" } })).value,
    ).toBe("dark");
    const miss = await evalTheme({ key: "anyone" });
    expect(miss.value).not.toBe("dark");

    // Deleting the segment leaves the rule unmatched — falls to default.
    const deleted = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/segments/beta-testers`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(deleted.status).toBe(200);
    clearConfigCache();
    expect((await evalTheme({ key: "beta-user" })).value).not.toBe("dark");
  });

  it("viewers cannot create segments", async () => {
    const cookie = await devLogin("viewer");
    const response = await SELF.fetch(
      `${BASE}/admin/projects/clawhub/segments`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          key: "nope",
          name: "Nope",
          contextKeys: [],
          rules: [],
        }),
      },
    );
    expect(response.status).toBe(403);
  });
});
