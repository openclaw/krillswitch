import type { AttributeRule, AttributeValue } from "./types.js";

/** A missing attribute never matches, for every operator — negations
 *  included. Serving a variation because data was absent is the classic
 *  targeting foot-gun. */
export function attributeRuleMatches(
  rule: AttributeRule,
  attributes: Record<string, AttributeValue> | undefined,
): boolean {
  const actual = attributes?.[rule.attribute];
  if (actual === undefined) {
    return false;
  }
  switch (rule.operator ?? "in") {
    case "in":
      return rule.values.includes(actual);
    case "not_in":
      return !rule.values.includes(actual);
    case "contains":
      return matchesString(actual, rule.values, (a, v) => a.includes(v));
    case "starts_with":
      return matchesString(actual, rule.values, (a, v) => a.startsWith(v));
    case "ends_with":
      return matchesString(actual, rule.values, (a, v) => a.endsWith(v));
    case "gt":
      return compareNumeric(actual, rule.values[0], (a, b) => a > b);
    case "gte":
      return compareNumeric(actual, rule.values[0], (a, b) => a >= b);
    case "lt":
      return compareNumeric(actual, rule.values[0], (a, b) => a < b);
    case "lte":
      return compareNumeric(actual, rule.values[0], (a, b) => a <= b);
    case "semver_gt":
      return compareSemver(actual, rule.values[0], (cmp) => cmp > 0);
    case "semver_lt":
      return compareSemver(actual, rule.values[0], (cmp) => cmp < 0);
    case "before":
      return compareDate(actual, rule.values[0], (a, b) => a < b);
    case "after":
      return compareDate(actual, rule.values[0], (a, b) => a > b);
  }
}

/** String operators only ever match string context values; numbers and
 *  booleans matching "contains 1" would be a surprise, not a feature. */
function matchesString(
  actual: AttributeValue,
  values: AttributeValue[],
  test: (actual: string, value: string) => boolean,
): boolean {
  if (typeof actual !== "string") {
    return false;
  }
  return values.some((value) => test(actual, String(value)));
}

function toNumber(value: AttributeValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function compareNumeric(
  actual: AttributeValue,
  value: AttributeValue | undefined,
  test: (actual: number, value: number) => boolean,
): boolean {
  const a = toNumber(actual);
  const b = toNumber(value);
  return a !== null && b !== null && test(a, b);
}

/** Dotted numeric versions ("1.2.3"); anything after a `-` or `+` is
 *  ignored, and unparseable versions never match. */
function parseSemver(value: AttributeValue | undefined): number[] | null {
  if (typeof value !== "string") {
    return null;
  }
  const core = value.replace(/^v/, "").split(/[-+]/, 1)[0] ?? "";
  const parts = core.split(".");
  if (parts.length === 0 || parts.length > 3) {
    return null;
  }
  const numbers = parts.map((part) =>
    /^\d+$/.test(part) ? Number(part) : Number.NaN,
  );
  if (numbers.some((part) => Number.isNaN(part))) {
    return null;
  }
  while (numbers.length < 3) {
    numbers.push(0);
  }
  return numbers;
}

function compareSemver(
  actual: AttributeValue,
  value: AttributeValue | undefined,
  test: (cmp: number) => boolean,
): boolean {
  const a = parseSemver(actual);
  const b = parseSemver(value);
  if (!a || !b) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return test((a[i] ?? 0) - (b[i] ?? 0));
    }
  }
  return test(0);
}

/** ISO-8601 strings or epoch milliseconds on either side. */
function toEpoch(value: AttributeValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function compareDate(
  actual: AttributeValue,
  value: AttributeValue | undefined,
  test: (actual: number, value: number) => boolean,
): boolean {
  const a = toEpoch(actual);
  const b = toEpoch(value);
  return a !== null && b !== null && test(a, b);
}
