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
      expect(["DISABLED", "TARGETING_MATCH", "SPLIT", "DEFAULT"]).toContain(
        flag.reason,
      );
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
    const response = await SELF.fetch(`https://krillswitch.test${BULK_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${DEV_EVAL_KEY}` },
    });
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
    const response = await SELF.fetch("https://flags.openclaw.ai/admin/me", {
      method: "GET",
    });
    expect(response.status).toBe(404);
  });
});

describe("OFREP degraded-configuration isolation", () => {
  // Admin validation normally prevents these references. Write directly to
  // local D1 to exercise the real Worker boundary with degraded stored data.
  const missingVariation = "missing-variation-internal-detail";
  const failure = {
    key: "souls",
    errorCode: "GENERAL",
    errorDetails: "Flag evaluation failed.",
  };

  async function restoreSouls(): Promise<void> {
    await env.DB.prepare(
      "UPDATE flag_environments SET enabled = 1, default_variation_id = 'var_souls_on', off_variation_id = 'var_souls_off', targets = '[]' WHERE id = 'fe_souls_dev'",
    ).run();
    clearConfigCache();
  }

  it.each(["default", "off", "target"] as const)(
    "returns a sanitized keyed failure for an unresolved %s variation",
    async (step) => {
      try {
        if (step === "default") {
          await env.DB.prepare(
            "UPDATE flag_environments SET default_variation_id = ? WHERE id = 'fe_souls_dev'",
          )
            .bind(missingVariation)
            .run();
        } else if (step === "off") {
          await env.DB.prepare(
            "UPDATE flag_environments SET enabled = 0, off_variation_id = ? WHERE id = 'fe_souls_dev'",
          )
            .bind(missingVariation)
            .run();
        } else {
          await env.DB.prepare(
            "UPDATE flag_environments SET targets = ? WHERE id = 'fe_souls_dev'",
          )
            .bind(
              JSON.stringify([
                { variationId: missingVariation, contextKeys: ["user-1"] },
              ]),
            )
            .run();
        }
        clearConfigCache();

        const bulk = await postOfrep({ evalKey: DEV_EVAL_KEY });
        expect(bulk.status).toBe(200);
        const body = (await bulk.json()) as { flags: unknown[] };
        expect(body.flags).toHaveLength(4);
        expect(body.flags).toContainEqual(failure);
        expect(body.flags).toContainEqual({
          key: "theme",
          value: "light",
          reason: "DEFAULT",
          variant: "var_theme_light",
        });
        expect(body.flags).toContainEqual(
          expect.objectContaining({ key: "rollout-demo", reason: "SPLIT" }),
        );
        expect(JSON.stringify(body)).not.toContain(missingVariation);

        const single = await postOfrep({
          evalKey: DEV_EVAL_KEY,
          path: `${BULK_PATH}/souls`,
        });
        expect(single.status).toBe(400);
        expect(single.headers.get("cache-control")).toBe("private, no-store");
        expect(await single.json()).toEqual(failure);
      } finally {
        await restoreSouls();
      }
    },
  );

  it("revalidates mixed results and recovers after the configuration cache refreshes", async () => {
    try {
      const healthy = await postOfrep({ evalKey: DEV_EVAL_KEY });
      const healthyBody = await healthy.json();
      const healthyEtag = healthy.headers.get("etag");
      await env.DB.prepare(
        "UPDATE flag_environments SET default_variation_id = ? WHERE id = 'fe_souls_dev'",
      )
        .bind(missingVariation)
        .run();
      clearConfigCache();

      const degraded = await postOfrep({
        evalKey: DEV_EVAL_KEY,
        headers: { "if-none-match": healthyEtag ?? "" },
      });
      expect(degraded.status).toBe(200);
      expect(degraded.headers.get("cache-control")).toBe("private, no-store");
      const degradedEtag = degraded.headers.get("etag");
      expect(degradedEtag).toBeTruthy();
      expect(degradedEtag).not.toBe(healthyEtag);
      expect(await degraded.json()).toMatchObject({
        flags: expect.arrayContaining([failure]),
      });

      const unchanged = await postOfrep({
        evalKey: DEV_EVAL_KEY,
        headers: { "if-none-match": degradedEtag ?? "" },
      });
      expect(unchanged.status).toBe(304);
      expect(await unchanged.text()).toBe("");
      expect(unchanged.headers.get("etag")).toBe(degradedEtag);

      // A failed evaluation must not mutate or poison the cached config.
      await env.DB.prepare(
        "UPDATE flag_environments SET default_variation_id = 'var_souls_on' WHERE id = 'fe_souls_dev'",
      ).run();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const recovered = await postOfrep({
        evalKey: DEV_EVAL_KEY,
        headers: { "if-none-match": degradedEtag ?? "" },
      });
      expect(recovered.status).toBe(200);
      expect(recovered.headers.get("etag")).toBe(healthyEtag);
      expect(await recovered.json()).toEqual(healthyBody);
      const single = await postOfrep({
        evalKey: DEV_EVAL_KEY,
        path: `${BULK_PATH}/souls`,
      });
      expect(single.status).toBe(200);
      expect(await single.json()).toMatchObject({ key: "souls", value: true });
    } finally {
      await restoreSouls();
    }
  });

  it("keeps the disabled off variation ahead of broken default and target references", async () => {
    try {
      await env.DB.prepare(
        "UPDATE flag_environments SET enabled = 0, default_variation_id = ?, targets = ? WHERE id = 'fe_souls_dev'",
      )
        .bind(
          missingVariation,
          JSON.stringify([
            { variationId: missingVariation, contextKeys: ["user-1"] },
          ]),
        )
        .run();
      clearConfigCache();
      const response = await postOfrep({
        evalKey: DEV_EVAL_KEY,
        path: `${BULK_PATH}/souls`,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        key: "souls",
        value: false,
        reason: "DISABLED",
        variant: "var_souls_off",
      });
    } finally {
      await restoreSouls();
    }
  });
});
