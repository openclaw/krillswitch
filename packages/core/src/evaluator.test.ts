import { describe, expect, it } from "vitest";
import { evaluateFlag } from "./evaluator";
import type { FlagConfig } from "./types";

const souls: FlagConfig = {
  key: "souls",
  kind: "boolean",
  enabled: true,
  variations: [
    { id: "var_souls_on", value: true },
    { id: "var_souls_off", value: false },
  ],
  offVariationId: "var_souls_off",
  defaultVariationId: "var_souls_on",
  targets: [],
  rules: [],
  rollout: null,
};

describe("evaluateFlag", () => {
  it("serves the default variation when the flag is enabled", () => {
    const result = evaluateFlag(souls, { key: "user-1" });
    expect(result).toEqual({
      value: true,
      variationId: "var_souls_on",
      reason: { kind: "default" },
    });
  });

  it("serves the off variation when the flag is disabled", () => {
    const result = evaluateFlag(
      { ...souls, enabled: false },
      { key: "user-1" },
    );
    expect(result).toEqual({
      value: false,
      variationId: "var_souls_off",
      reason: { kind: "off" },
    });
  });

  it("throws on a variation id that is not in the flag's variations", () => {
    const broken: FlagConfig = { ...souls, defaultVariationId: "var_missing" };
    expect(() => evaluateFlag(broken, { key: "user-1" })).toThrowError(
      /var_missing/,
    );
  });
});
