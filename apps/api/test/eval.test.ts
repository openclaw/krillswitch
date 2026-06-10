import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { EvalResponseBody } from "@openclaw/krillswitch-core";
import { beforeAll, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";

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
