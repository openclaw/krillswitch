export { CONFIG_CACHE_TTL_MS } from "./config.js";
export { evaluateFlag, type SegmentMap } from "./evaluator.js";
export { rolloutBucket } from "./hash.js";
export { attributeRuleMatches } from "./operators.js";
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
} from "./types.js";
