import type { RuleOperator } from "./api";

/** Sentence-style operator labels shared by the flag rule and segment rule
 *  editors. Order here is the select-menu order. */
export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  in: "is one of",
  not_in: "is not one of",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  semver_gt: "semver >",
  semver_lt: "semver <",
  before: "before",
  after: "after",
};

export const OPERATOR_ORDER = Object.keys(OPERATOR_LABELS) as RuleOperator[];
