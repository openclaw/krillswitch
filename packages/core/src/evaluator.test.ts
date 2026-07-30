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

// String-multivariate flag with the full targeting chain configured:
// allowlist pins "user-pinned" to system, role=admin gets dark, default light.
const theme: FlagConfig = {
  key: "theme",
  kind: "string",
  enabled: true,
  variations: [
    { id: "var_theme_light", value: "light" },
    { id: "var_theme_dark", value: "dark" },
    { id: "var_theme_system", value: "system" },
  ],
  offVariationId: "var_theme_light",
  defaultVariationId: "var_theme_light",
  targets: [{ variationId: "var_theme_system", contextKeys: ["user-pinned"] }],
  rules: [
    { variationId: "var_theme_dark", attribute: "role", values: ["admin"] },
  ],
  rollout: null,
};

describe("evaluateFlag precedence", () => {
  it("off beats allowlist and rules", () => {
    const result = evaluateFlag(
      { ...theme, enabled: false },
      { key: "user-pinned", attributes: { role: "admin" } },
    );
    expect(result).toEqual({
      value: "light",
      variationId: "var_theme_light",
      reason: { kind: "off" },
    });
  });

  it("allowlist beats a matching attribute rule", () => {
    const result = evaluateFlag(theme, {
      key: "user-pinned",
      attributes: { role: "admin" },
    });
    expect(result).toEqual({
      value: "system",
      variationId: "var_theme_system",
      reason: { kind: "target" },
    });
  });

  it("a matching attribute rule beats the default", () => {
    const result = evaluateFlag(theme, {
      key: "user-2",
      attributes: { role: "admin" },
    });
    expect(result).toEqual({
      value: "dark",
      variationId: "var_theme_dark",
      reason: { kind: "rule", attribute: "role" },
    });
  });

  it("first matching rule wins when several are configured", () => {
    const stacked: FlagConfig = {
      ...theme,
      rules: [
        { variationId: "var_theme_system", attribute: "plan", values: ["pro"] },
        { variationId: "var_theme_dark", attribute: "role", values: ["admin"] },
      ],
    };
    const result = evaluateFlag(stacked, {
      key: "user-2",
      attributes: { role: "admin", plan: "pro" },
    });
    expect(result.variationId).toBe("var_theme_system");
  });

  it("falls through to the default when nothing matches", () => {
    const result = evaluateFlag(theme, {
      key: "user-2",
      attributes: { role: "member" },
    });
    expect(result).toEqual({
      value: "light",
      variationId: "var_theme_light",
      reason: { kind: "default" },
    });
  });

  it("does not match rules when the context has no attributes", () => {
    const result = evaluateFlag(theme, { key: "user-2" });
    expect(result.reason).toEqual({ kind: "default" });
  });

  it("does not match a rule whose value type differs from the attribute", () => {
    const result = evaluateFlag(theme, {
      key: "user-2",
      attributes: { role: 5 },
    });
    expect(result.reason).toEqual({ kind: "default" });
  });

  it("serves a rollout variation between rules and default", () => {
    const rolled: FlagConfig = {
      ...theme,
      rollout: {
        variations: [
          { variationId: "var_theme_dark", weight: 50 },
          { variationId: "var_theme_light", weight: 50 },
        ],
      },
    };
    const result = evaluateFlag(rolled, { key: "user-2" });
    expect(result.reason.kind).toBe("rollout");
    expect(["var_theme_dark", "var_theme_light"]).toContain(result.variationId);
  });

  it("round-trips number and JSON variation values", () => {
    const limits: FlagConfig = {
      key: "page-size",
      kind: "number",
      enabled: true,
      variations: [
        { id: "var_ten", value: 10 },
        { id: "var_fifty", value: 50 },
      ],
      offVariationId: "var_ten",
      defaultVariationId: "var_fifty",
      targets: [],
      rules: [],
      rollout: null,
    };
    expect(evaluateFlag(limits, { key: "u" }).value).toBe(50);

    const banner: FlagConfig = {
      key: "banner",
      kind: "json",
      enabled: true,
      variations: [
        { id: "var_off", value: null },
        { id: "var_promo", value: { text: "hi", level: 2 } },
      ],
      offVariationId: "var_off",
      defaultVariationId: "var_promo",
      targets: [],
      rules: [],
      rollout: null,
    };
    expect(evaluateFlag(banner, { key: "u" }).value).toEqual({
      text: "hi",
      level: 2,
    });
  });
});

describe("segment rules", () => {
  const flag: FlagConfig = {
    ...theme,
    rules: [
      { variationId: "var_theme_dark", segment: "beta-testers" },
      { variationId: "var_theme_system", attribute: "role", values: ["ops"] },
    ],
  };
  const segments = {
    "beta-testers": {
      key: "beta-testers",
      contextKeys: ["beta-user"],
      rules: [{ attribute: "plan", values: ["beta"] }],
    },
  };

  it("matches by segment context key", () => {
    const result = evaluateFlag(flag, { key: "beta-user" }, segments);
    expect(result.reason).toEqual({
      kind: "segment",
      segment: "beta-testers",
    });
    expect(result.value).toBe("dark");
  });

  it("matches by segment attribute rule", () => {
    const result = evaluateFlag(
      flag,
      { key: "someone", attributes: { plan: "beta" } },
      segments,
    );
    expect(result.reason).toEqual({
      kind: "segment",
      segment: "beta-testers",
    });
  });

  it("falls through to later attribute rules when the segment misses", () => {
    const result = evaluateFlag(
      flag,
      { key: "someone", attributes: { role: "ops" } },
      segments,
    );
    expect(result.reason).toEqual({ kind: "rule", attribute: "role" });
  });

  it("an unknown or deleted segment never matches", () => {
    const result = evaluateFlag(flag, { key: "beta-user" }, {});
    expect(result.reason).toEqual({ kind: "default" });
  });
});
