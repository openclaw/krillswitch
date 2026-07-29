export { CONFIG_CACHE_TTL_MS } from "./config";
export { evaluateFlag, type SegmentMap } from "./evaluator";
export { rolloutBucket } from "./hash";
export type {
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
  SegmentConfig,
  TargetingRule,
  UserTarget,
  Variation,
} from "./types";
