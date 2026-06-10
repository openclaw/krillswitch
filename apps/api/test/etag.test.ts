import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
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

async function postEval(ifNoneMatch?: string): Promise<Response> {
  const headers = new Headers({
    authorization: `Bearer ${DEV_EVAL_KEY}`,
    "content-type": "application/json",
  });
  if (ifNoneMatch) {
    headers.set("if-none-match", ifNoneMatch);
  }
  return SELF.fetch("https://krillswitch.test/v1/eval", {
    method: "POST",
    headers,
    body: JSON.stringify({ context: { key: "x" } }),
  });
}

beforeEach(async () => {
  clearConfigCache();
  await applySeed();
  await env.DB.prepare(
    "UPDATE flag_environments SET enabled = 1 WHERE id = 'fe_souls_dev'",
  ).run();
});

describe("eval ETag", () => {
  it("returns 304 with no body when values are unchanged", async () => {
    const first = await postEval();
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await postEval(etag ?? undefined);
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("returns 200 with a new ETag after a flag change", async () => {
    const first = await postEval();
    const etag = first.headers.get("etag");

    await env.DB.prepare(
      "UPDATE flag_environments SET enabled = 0 WHERE id = 'fe_souls_dev'",
    ).run();
    clearConfigCache();

    const second = await postEval(etag ?? undefined);
    expect(second.status).toBe(200);
    expect(second.headers.get("etag")).toBeTruthy();
    expect(second.headers.get("etag")).not.toBe(etag);
  });
});
