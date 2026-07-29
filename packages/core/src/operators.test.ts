import { describe, expect, it } from "vitest";
import { attributeRuleMatches } from "./operators";
import type { AttributeRule, AttributeValue } from "./types";

function matches(
  rule: Omit<AttributeRule, "attribute">,
  actual: AttributeValue | undefined,
): boolean {
  const attributes = actual === undefined ? {} : { attr: actual };
  return attributeRuleMatches({ attribute: "attr", ...rule }, attributes);
}

describe("attributeRuleMatches", () => {
  it("defaults a missing operator to in (shipped rule shape)", () => {
    expect(matches({ values: ["a", "b"] }, "a")).toBe(true);
    expect(matches({ values: ["a", "b"] }, "c")).toBe(false);
  });

  it("never matches a missing attribute, negations included", () => {
    for (const operator of [
      "in",
      "not_in",
      "contains",
      "gt",
      "before",
    ] as const) {
      expect(matches({ operator, values: ["x"] }, undefined)).toBe(false);
    }
    expect(
      attributeRuleMatches({ attribute: "a", values: ["x"] }, undefined),
    ).toBe(false);
  });

  it("not_in matches values outside the list", () => {
    expect(matches({ operator: "not_in", values: ["a"] }, "b")).toBe(true);
    expect(matches({ operator: "not_in", values: ["a"] }, "a")).toBe(false);
  });

  describe("string operators", () => {
    it("contains matches any value as a substring", () => {
      expect(
        matches({ operator: "contains", values: ["corp", "inc"] }, "acme-inc"),
      ).toBe(true);
      expect(matches({ operator: "contains", values: ["corp"] }, "acme")).toBe(
        false,
      );
    });

    it("starts_with and ends_with anchor the match", () => {
      expect(
        matches({ operator: "starts_with", values: ["beta-"] }, "beta-user"),
      ).toBe(true);
      expect(
        matches(
          { operator: "ends_with", values: ["@openclaw.ai"] },
          "krill@openclaw.ai",
        ),
      ).toBe(true);
      expect(
        matches({ operator: "starts_with", values: ["beta-"] }, "user-beta-"),
      ).toBe(false);
    });

    it("string operators reject non-string context values", () => {
      expect(matches({ operator: "contains", values: ["1"] }, 12)).toBe(false);
    });
  });

  describe("numeric operators", () => {
    it("compares numbers and numeric strings", () => {
      expect(matches({ operator: "gt", values: [10] }, 11)).toBe(true);
      expect(matches({ operator: "gt", values: [10] }, "11")).toBe(true);
      expect(matches({ operator: "gte", values: [10] }, 10)).toBe(true);
      expect(matches({ operator: "lt", values: ["10"] }, 9)).toBe(true);
      expect(matches({ operator: "lte", values: [10] }, 11)).toBe(false);
    });

    it("non-numeric values never match", () => {
      expect(matches({ operator: "gt", values: [10] }, "abc")).toBe(false);
      expect(matches({ operator: "gt", values: ["abc"] }, 11)).toBe(false);
    });
  });

  describe("semver operators", () => {
    it("compares dotted versions numerically, not lexically", () => {
      expect(
        matches({ operator: "semver_gt", values: ["1.9.0"] }, "1.10.0"),
      ).toBe(true);
      expect(
        matches({ operator: "semver_lt", values: ["2.0.0"] }, "1.99.9"),
      ).toBe(true);
      expect(
        matches({ operator: "semver_gt", values: ["1.2.3"] }, "1.2.3"),
      ).toBe(false);
    });

    it("accepts v prefixes and short versions, ignores prerelease tags", () => {
      expect(
        matches({ operator: "semver_gt", values: ["v1.2"] }, "1.3.0-rc.1"),
      ).toBe(true);
    });

    it("unparseable versions never match", () => {
      expect(
        matches({ operator: "semver_gt", values: ["1.0.0"] }, "latest"),
      ).toBe(false);
    });
  });

  describe("date operators", () => {
    it("compares ISO strings and epoch milliseconds", () => {
      expect(
        matches({ operator: "before", values: ["2026-01-01"] }, "2025-06-15"),
      ).toBe(true);
      expect(
        matches(
          { operator: "after", values: ["2026-01-01"] },
          Date.UTC(2026, 5, 1),
        ),
      ).toBe(true);
      expect(
        matches({ operator: "after", values: ["2026-01-01"] }, "2025-06-15"),
      ).toBe(false);
    });

    it("unparseable dates never match", () => {
      expect(
        matches({ operator: "before", values: ["not a date"] }, "2025-01-01"),
      ).toBe(false);
    });
  });
});
