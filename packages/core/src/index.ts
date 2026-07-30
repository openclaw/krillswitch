export { CONFIG_CACHE_TTL_MS } from "./config";
export { evaluateFlag, type SegmentMap } from "./evaluator";
export { rolloutBucket } from "./hash";
export { attributeRuleMatches } from "./operators";
export type {
  AttributeRule,
  AttributeValue,
  EvalContext,
  EvalReason,
  EvalRequestBody,
  EvalResponseBody,
  FlagConfig,
  FlagEvaluation,
  FlagKind,
  FlagValue,
  JsonValue,
  Rollout,
  RolloutVariation,
  RuleOperator,
  SegmentConfig,
  TargetingRule,
  UserTarget,
  Variation,
} from "./types";
