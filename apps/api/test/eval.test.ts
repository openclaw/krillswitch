import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  type EvalResponseBody,
  evaluateFlag,
  type FlagConfig,
} from "@openclaw/krillswitch-core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import { clearConfigCache } from "../src/configCache";

const DEV_EVAL_KEY = "ks_clawhub_development_local";

// Reuses the real seed file so the fixture the curl proofs rely on is the
// same one these tests prove. One statement per line, comments skipped.
async function applySeed(): Promise<void> {
  const statements = seedSql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
}

async function postEval(options: {
  evalKey?: string;
  body?: unknown;
}): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.evalKey !== undefined) {
    headers.set("authorization", `Bearer ${options.evalKey}`);
  }
  return SELF.fetch("https://krillswitch.test/v1/eval", {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? { context: { key: "x" } }),
  });
}

beforeAll(async () => {
  await applySeed();
});

beforeEach(async () => {
  // The module-scope config cache and D1 writes both outlive a test in this
  // pool version: clear the cache and undo flag edits.
  clearConfigCache();
  await env.DB.prepare(
    "UPDATE flag_environments SET enabled = 1 WHERE id = 'fe_souls_dev'",
  ).run();
});

describe("POST /v1/eval", () => {
  it("returns the seeded souls flag's default value for the development key", async () => {
    const response = await postEval({ evalKey: DEV_EVAL_KEY });
    expect(response.status).toBe(200);
    const body = (await response.json()) as EvalResponseBody;
    expect(body.flags.souls).toEqual({
      value: true,
      variationId: "var_souls_on",
      reason: { kind: "default" },
    });
  });

  it("serves the off variation after the flag is disabled in D1", async () => {
    await env.DB.prepare(
      "UPDATE flag_environments SET enabled = 0 WHERE id = 'fe_souls_dev'",
    ).run();
    const response = await postEval({ evalKey: DEV_EVAL_KEY });
    expect(response.status).toBe(200);
    const body = (await response.json()) as EvalResponseBody;
    expect(body.flags.souls).toEqual({
      value: false,
      variationId: "var_souls_off",
      reason: { kind: "off" },
    });
  });

  it("resolves the theme string flag through the targeting chain", async () => {
    const allowlisted = await postEval({
      evalKey: DEV_EVAL_KEY,
      body: { context: { key: "user-pinned", attributes: { role: "admin" } } },
    });
    const allowlistedBody = (await allowlisted.json()) as EvalResponseBody;
    expect(allowlistedBody.flags.theme).toEqual({
      value: "system",
      variationId: "var_theme_system",
      reason: { kind: "target" },
    });

    const admin = await postEval({
      evalKey: DEV_EVAL_KEY,
      body: { context: { key: "user-2", attributes: { role: "admin" } } },
    });
    const adminBody = (await admin.json()) as EvalResponseBody;
    expect(adminBody.flags.theme).toEqual({
      value: "dark",
      variationId: "var_theme_dark",
      reason: { kind: "rule", attribute: "role" },
    });

    const noMatch = await postEval({
      evalKey: DEV_EVAL_KEY,
      body: { context: { key: "user-2" } },
    });
    const noMatchBody = (await noMatch.json()) as EvalResponseBody;
    expect(noMatchBody.flags.theme).toEqual({
      value: "light",
      variationId: "var_theme_light",
      reason: { kind: "default" },
    });
  });

  it("buckets rollout-demo identically to a direct core evaluation", async () => {
    // Mirrors the seeded fe_rollout_demo_dev row; drift between this fixture
    // and seed.sql fails the toEqual below.
    const seededConfig: FlagConfig = {
      key: "rollout-demo",
      kind: "string",
      enabled: true,
      variations: [
        { id: "var_rollout_a", value: "a" },
        { id: "var_rollout_b", value: "b" },
      ],
      offVariationId: "var_rollout_a",
      defaultVariationId: "var_rollout_a",
      targets: [],
      rules: [],
      rollout: {
        variations: [
          { variationId: "var_rollout_a", weight: 50 },
          { variationId: "var_rollout_b", weight: 50 },
        ],
      },
    };

    for (const key of ["user-1", "user-2", "user-3", "user-4"]) {
      const expected = evaluateFlag(seededConfig, { key });
      const response = await postEval({
        evalKey: DEV_EVAL_KEY,
        body: { context: { key } },
      });
      const body = (await response.json()) as EvalResponseBody;
      expect(body.flags["rollout-demo"]).toEqual(expected);
      expect(body.flags["rollout-demo"]?.reason).toEqual({ kind: "rollout" });
    }
  });

  it("allows cross-origin browser calls (public eval endpoint)", async () => {
    const preflight = await SELF.fetch("https://krillswitch.test/v1/eval", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(
      preflight.headers.get("access-control-allow-headers")?.toLowerCase(),
    ).toContain("authorization");
    expect(preflight.headers.get("access-control-max-age")).toBe("86400");

    const response = await postEval({ evalKey: DEV_EVAL_KEY });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    // Without exposing ETag, browsers can't read it and conditional
    // requests silently degrade to full 200s.
    expect(
      response.headers.get("access-control-expose-headers")?.toLowerCase(),
    ).toContain("etag");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects a wrong eval key without serving flag data", async () => {
    const response = await postEval({ evalKey: "ks_wrong_key" });
    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "invalid_eval_key" });
  });

  it("rejects a missing eval key without serving flag data", async () => {
    const response = await postEval({});
    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "missing_eval_key" });
  });

  it("rejects a body without a context key", async () => {
    const response = await postEval({
      evalKey: DEV_EVAL_KEY,
      body: { context: {} },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_request");
  });
});
