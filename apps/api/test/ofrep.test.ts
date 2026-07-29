import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.sql?raw";
import { clearConfigCache } from "../src/configCache";

const DEV_EVAL_KEY = "ks_clawhub_development_local";
const BULK_PATH = "/ofrep/v1/evaluate/flags";

async function applySeed(): Promise<void> {
  const statements = seedSql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
}

async function postOfrep(options: {
  evalKey?: string;
  path?: string;
  body?: unknown;
  headers?: Record<string, string>;
  baseUrl?: string;
}): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json",
    ...options.headers,
  });
  if (options.evalKey !== undefined) {
    headers.set("authorization", `Bearer ${options.evalKey}`);
  }
  return SELF.fetch(
    `${options.baseUrl ?? "https://krillswitch.test"}${options.path ?? BULK_PATH}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(
        options.body ?? { context: { targetingKey: "user-1" } },
      ),
    },
  );
}

type OfrepFlag = {
  key: string;
  value: unknown;
  reason: string;
  variant: string;
};

beforeAll(async () => {
  await applySeed();
});

beforeEach(async () => {
  clearConfigCache();
  await env.DB.prepare(
    "UPDATE flag_environments SET enabled = 1 WHERE id = 'fe_souls_dev'",
  ).run();
});

describe("POST /ofrep/v1/evaluate/flags (bulk)", () => {
  it("evaluates every flag with OpenFeature reasons and variants", async () => {
    const response = await postOfrep({ evalKey: DEV_EVAL_KEY });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { flags: OfrepFlag[] };
    expect(body.flags.length).toBeGreaterThan(0);
    const souls = body.flags.find((flag) => flag.key === "souls");
    expect(souls).toBeDefined();
    expect(souls?.value).toBe(true);
    expect(souls?.reason).toBe("DEFAULT");
    expect(typeof souls?.variant).toBe("string");
    for (const flag of body.flags) {
      expect([
        "DISABLED",
        "TARGETING_MATCH",
        "SPLIT",
        "DEFAULT",
      ]).toContain(flag.reason);
    }
  });

  it("maps extra context properties to targeting attributes", async () => {
    // Seeded theme flag: role=admin serves dark via an attribute rule.
    const response = await postOfrep({
      evalKey: DEV_EVAL_KEY,
      body: { context: { targetingKey: "user-1", role: "admin" } },
    });
    const body = (await response.json()) as { flags: OfrepFlag[] };
    const theme = body.flags.find((flag) => flag.key === "theme");
    expect(theme?.value).toBe("dark");
    expect(theme?.reason).toBe("TARGETING_MATCH");
  });

  it("serves DISABLED with the off variation for a disabled flag", async () => {
    await env.DB.prepare(
      "UPDATE flag_environments SET enabled = 0 WHERE id = 'fe_souls_dev'",
    ).run();
    clearConfigCache();
    const response = await postOfrep({ evalKey: DEV_EVAL_KEY });
    const body = (await response.json()) as { flags: OfrepFlag[] };
    const souls = body.flags.find((flag) => flag.key === "souls");
    expect(souls?.value).toBe(false);
    expect(souls?.reason).toBe("DISABLED");
  });

  it("supports ETag revalidation with 304", async () => {
    const first = await postOfrep({ evalKey: DEV_EVAL_KEY });
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const second = await postOfrep({
      evalKey: DEV_EVAL_KEY,
      headers: { "if-none-match": etag ?? "" },
    });
    expect(second.status).toBe(304);
  });

  it("rejects a missing eval key with 401", async () => {
    const response = await postOfrep({});
    expect(response.status).toBe(401);
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("GENERAL");
  });

  it("rejects a missing targetingKey with TARGETING_KEY_MISSING", async () => {
    const response = await postOfrep({
      evalKey: DEV_EVAL_KEY,
      body: { context: { role: "admin" } },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("TARGETING_KEY_MISSING");
  });

  it("rejects a bodyless request with INVALID_CONTEXT", async () => {
    const response = await SELF.fetch(
      `https://krillswitch.test${BULK_PATH}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${DEV_EVAL_KEY}` },
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("INVALID_CONTEXT");
  });
});

describe("POST /ofrep/v1/evaluate/flags/:key (single)", () => {
  it("evaluates one flag by key", async () => {
    const response = await postOfrep({
      evalKey: DEV_EVAL_KEY,
      path: `${BULK_PATH}/souls`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as OfrepFlag;
    expect(body.key).toBe("souls");
    expect(body.value).toBe(true);
    expect(body.reason).toBe("DEFAULT");
  });

  it("returns FLAG_NOT_FOUND for an unknown key", async () => {
    const response = await postOfrep({
      evalKey: DEV_EVAL_KEY,
      path: `${BULK_PATH}/nope`,
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { key: string; errorCode: string };
    expect(body.key).toBe("nope");
    expect(body.errorCode).toBe("FLAG_NOT_FOUND");
  });
});

describe("OFREP hostname trust boundary", () => {
  it("serves OFREP on the public eval hostname", async () => {
    const response = await postOfrep({
      evalKey: DEV_EVAL_KEY,
      baseUrl: "https://flags.openclaw.ai",
    });
    expect(response.status).toBe(200);
  });

  it("blocks OFREP on the admin hostname", async () => {
    const response = await postOfrep({
      evalKey: DEV_EVAL_KEY,
      baseUrl: "https://switch.openclaw.ai",
    });
    expect(response.status).toBe(404);
  });

  it("keeps non-eval paths blocked on the public eval hostname", async () => {
    const response = await SELF.fetch(
      "https://flags.openclaw.ai/admin/me",
      { method: "GET" },
    );
    expect(response.status).toBe(404);
  });
});
