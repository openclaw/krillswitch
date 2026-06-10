import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { EvalResponseBody } from "@openclaw/krillswitch-core";
import { beforeEach, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import { clearConfigCache } from "../src/configCache";

const DEV_EVAL_KEY = "ks_clawhub_development_local";

async function applySeed(): Promise<void> {
  const statements = seedSql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
}

async function postEval(): Promise<Response> {
  return SELF.fetch("https://krillswitch.test/v1/eval", {
    method: "POST",
    headers: {
      authorization: `Bearer ${DEV_EVAL_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ context: { key: "x" } }),
  });
}

function serverTiming(response: Response): string {
  const header = response.headers.get("server-timing");
  expect(header).not.toBeNull();
  return header ?? "";
}

function evalDurationMs(timing: string): number {
  const match = timing.match(/eval;dur=([\d.]+)/);
  expect(match, `eval entry in "${timing}"`).not.toBeNull();
  return Number(match?.[1]);
}

async function soulsValue(response: Response): Promise<unknown> {
  const body = (await response.json()) as EvalResponseBody;
  return body.flags.souls?.value;
}

async function disableSoulsInD1(): Promise<void> {
  await env.DB.prepare(
    "UPDATE flag_environments SET enabled = 0 WHERE id = 'fe_souls_dev'",
  ).run();
}

beforeEach(async () => {
  clearConfigCache();
  await applySeed();
  // No per-test storage rollback in this pool version: undo flag edits.
  await env.DB.prepare(
    "UPDATE flag_environments SET enabled = 1 WHERE id = 'fe_souls_dev'",
  ).run();
});

describe("config cache", () => {
  it("serves the second rapid request as a sub-millisecond cache hit", async () => {
    const first = await postEval();
    expect(serverTiming(first)).toContain("cache;desc=miss");

    const second = await postEval();
    const timing = serverTiming(second);
    expect(timing).toContain("cache;desc=hit");
    expect(evalDurationMs(timing)).toBeLessThan(1);
  });

  it("keeps serving the cached value within the TTL after a D1 edit", async () => {
    await expect(soulsValue(await postEval())).resolves.toBe(true);
    await disableSoulsInD1();
    const response = await postEval();
    expect(serverTiming(response)).toContain("cache;desc=hit");
    await expect(soulsValue(response)).resolves.toBe(true);
  });

  it("serves the new value once the TTL has passed", async () => {
    await expect(soulsValue(await postEval())).resolves.toBe(true);
    await disableSoulsInD1();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const response = await postEval();
    expect(serverTiming(response)).toContain("cache;desc=miss");
    await expect(soulsValue(response)).resolves.toBe(false);
  });

  it("reads D1 once for a burst of requests", async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => postEval()),
    );
    const misses = responses.filter((response) =>
      serverTiming(response).includes("cache;desc=miss"),
    );
    expect(misses).toHaveLength(1);
  });
});
