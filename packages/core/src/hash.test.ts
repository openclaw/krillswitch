import { describe, expect, it } from "vitest";
import { evaluateFlag } from "./evaluator";
import { rolloutBucket } from "./hash";
import type { FlagConfig } from "./types";

function rolloutFlag(weights: [number, number], key = "beta"): FlagConfig {
  return {
    key,
    kind: "string",
    enabled: true,
    variations: [
      { id: "var_a", value: "a" },
      { id: "var_b", value: "b" },
    ],
    offVariationId: "var_a",
    defaultVariationId: "var_a",
    targets: [],
    rules: [],
    rollout: {
      variations: [
        { variationId: "var_a", weight: weights[0] },
        { variationId: "var_b", weight: weights[1] },
      ],
    },
  };
}

describe("rolloutBucket", () => {
  it("returns a bucket in [0, 100)", () => {
    for (let i = 0; i < 1000; i++) {
      const bucket = rolloutBucket("beta", `user-${i}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it("is deterministic for the same flag and context key", () => {
    expect(rolloutBucket("beta", "user-42")).toBe(
      rolloutBucket("beta", "user-42"),
    );
  });

  it("spreads consecutive context keys instead of clustering them", () => {
    // GitHub user ids are roughly sequential; near-identical keys must not
    // land in one band. Plain FNV-1a fails this without a final mix.
    const flag = rolloutFlag([50, 50]);
    const variations = new Set(
      Array.from(
        { length: 20 },
        (_, i) => evaluateFlag(flag, { key: `user-${i}` }).variationId,
      ),
    );
    expect(variations.size).toBe(2);
  });

  it("buckets the same context keys differently across flag keys", () => {
    const keys = Array.from({ length: 100 }, (_, i) => `user-${i}`);
    const underBeta = keys.map((k) => rolloutBucket("beta", k));
    const underGamma = keys.map((k) => rolloutBucket("gamma", k));
    expect(underBeta).not.toEqual(underGamma);
  });
});

describe("weighted rollout split", () => {
  it("returns the identical variation for 1,000 repeated evals of one key", () => {
    const flag = rolloutFlag([50, 50]);
    const first = evaluateFlag(flag, { key: "user-42" }).variationId;
    for (let i = 0; i < 1000; i++) {
      expect(evaluateFlag(flag, { key: "user-42" }).variationId).toBe(first);
    }
  });

  it("lands 10,000 distinct keys near a 10/90 split", () => {
    const flag = rolloutFlag([10, 90]);
    let inA = 0;
    for (let i = 0; i < 10_000; i++) {
      if (evaluateFlag(flag, { key: `user-${i}` }).variationId === "var_a") {
        inA += 1;
      }
    }
    const shareA = (inA / 10_000) * 100;
    expect(shareA).toBeGreaterThan(8.5);
    expect(shareA).toBeLessThan(11.5);
  });

  it("growing a weight re-buckets only the boundary share", () => {
    const narrow = rolloutFlag([10, 90]);
    const wide = rolloutFlag([20, 80]);
    for (let i = 0; i < 2000; i++) {
      const key = `user-${i}`;
      if (evaluateFlag(narrow, { key }).variationId === "var_a") {
        // Anyone in the first 10% stays in the first 20%.
        expect(evaluateFlag(wide, { key }).variationId).toBe("var_a");
      }
    }
  });

  it("reports the rollout reason", () => {
    const result = evaluateFlag(rolloutFlag([50, 50]), { key: "user-1" });
    expect(result.reason).toEqual({ kind: "rollout" });
  });
});
