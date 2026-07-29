export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type FlagValue = JsonValue;

export type FlagKind = "boolean" | "string" | "number" | "json";

export interface Variation {
  id: string;
  value: FlagValue;
}

export type AttributeValue = string | number | boolean;

/** Pins specific context keys to a variation (highest targeting precedence). */
export interface UserTarget {
  variationId: string;
  contextKeys: string[];
}

/** How an attribute rule compares the context value against `values`.
 *  Comparison and date operators use values[0]; list/string operators match
 *  any entry. Stored rules without an operator are `in` — the shipped
 *  shape predating operators. */
export type RuleOperator =
  | "in"
  | "not_in"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "semver_gt"
  | "semver_lt"
  | "before"
  | "after";

export interface AttributeRule {
  attribute: string;
  operator?: RuleOperator;
  values: AttributeValue[];
}

/** Matches a context attribute against a value list (e.g. role in [admin]),
 *  or membership of a named project segment. Stored rules without a
 *  `segment` field are attribute rules — the shipped shape. */
export type TargetingRule =
  | ({ variationId: string } & AttributeRule)
  | { variationId: string; segment: string };

/** Reusable, project-scoped audience: pinned context keys plus attribute
 *  rules. A context is in the segment when either matches. */
export interface SegmentConfig {
  key: string;
  contextKeys: string[];
  rules: AttributeRule[];
}

export interface RolloutVariation {
  variationId: string;
  /** Relative weight; weights across a rollout sum to 100. */
  weight: number;
}

/** Percentage split applied after targets and rules, before the default. */
export interface Rollout {
  variations: RolloutVariation[];
}

export interface FlagConfig {
  key: string;
  kind: FlagKind;
  enabled: boolean;
  variations: Variation[];
  /** Served when the flag is off. */
  offVariationId: string;
  /** Served when the flag is on and no targeting matches. */
  defaultVariationId: string;
  targets: UserTarget[];
  rules: TargetingRule[];
  rollout: Rollout | null;
}

export interface EvalContext {
  key: string;
  attributes?: Record<string, AttributeValue>;
}

export type EvalReason =
  | { kind: "off" }
  | { kind: "target" }
  | { kind: "rule"; attribute: string }
  | { kind: "segment"; segment: string }
  | { kind: "rollout" }
  | { kind: "default" };

export interface FlagEvaluation {
  value: FlagValue;
  variationId: string;
  reason: EvalReason;
}

/** Wire contract for POST /v1/eval. */
export interface EvalRequestBody {
  context: EvalContext;
}

export interface EvalResponseBody {
  flags: Record<string, FlagEvaluation>;
}
