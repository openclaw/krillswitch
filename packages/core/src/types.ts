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

/** Matches a context attribute against a value list (e.g. role in [admin]). */
export interface TargetingRule {
  variationId: string;
  attribute: string;
  values: AttributeValue[];
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

export type EvalReason = { kind: "off" } | { kind: "default" };

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
