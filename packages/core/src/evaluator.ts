import { rolloutBucket } from "./hash.js";
import { attributeRuleMatches } from "./operators.js";
import type {
  EvalContext,
  FlagConfig,
  FlagEvaluation,
  SegmentConfig,
  Variation,
} from "./types.js";

export type SegmentMap = Record<string, SegmentConfig>;

function segmentMatches(segment: SegmentConfig, context: EvalContext): boolean {
  if (segment.contextKeys.includes(context.key)) {
    return true;
  }
  return segment.rules.some((rule) =>
    attributeRuleMatches(rule, context.attributes),
  );
}

function variationById(flag: FlagConfig, variationId: string): Variation {
  const variation = flag.variations.find((v) => v.id === variationId);
  if (!variation) {
    throw new Error(
      `flag "${flag.key}" references unknown variation "${variationId}"`,
    );
  }
  return variation;
}

function serve(
  flag: FlagConfig,
  variationId: string,
  reason: FlagEvaluation["reason"],
): FlagEvaluation {
  const variation = variationById(flag, variationId);
  return { value: variation.value, variationId: variation.id, reason };
}

type EvaluationStep = (
  flag: FlagConfig,
  context: EvalContext,
  segments: SegmentMap,
) => FlagEvaluation | null;

const offVariation: EvaluationStep = (flag) =>
  flag.enabled ? null : serve(flag, flag.offVariationId, { kind: "off" });

const targetMatch: EvaluationStep = (flag, context) => {
  const target = flag.targets.find((t) => t.contextKeys.includes(context.key));
  return target ? serve(flag, target.variationId, { kind: "target" }) : null;
};

const ruleMatch: EvaluationStep = (flag, context, segments) => {
  for (const rule of flag.rules) {
    if ("segment" in rule) {
      // Unknown segment keys (e.g. a deleted segment) never match.
      const segment = segments[rule.segment];
      if (segment && segmentMatches(segment, context)) {
        return serve(flag, rule.variationId, {
          kind: "segment",
          segment: rule.segment,
        });
      }
      continue;
    }
    if (attributeRuleMatches(rule, context.attributes)) {
      return serve(flag, rule.variationId, {
        kind: "rule",
        attribute: rule.attribute,
      });
    }
  }
  return null;
};

// Placeholder split: serves the first weighted variation. Replaced by a
const rolloutSplit: EvaluationStep = (flag, context) => {
  if (!flag.rollout || flag.rollout.variations.length === 0) {
    return null;
  }
  const bucket = rolloutBucket(flag.key, context.key);
  let cumulative = 0;
  for (const candidate of flag.rollout.variations) {
    cumulative += candidate.weight;
    if (bucket < cumulative) {
      return serve(flag, candidate.variationId, { kind: "rollout" });
    }
  }
  // Weights are validated to sum to 100 at the write boundary; if a bucket
  // still lands past the last threshold, fall through to the default.
  return null;
};

const defaultVariation: EvaluationStep = (flag) =>
  serve(flag, flag.defaultVariationId, { kind: "default" });

/** Precedence order fixed by the PRD; earlier steps win. */
const steps: readonly EvaluationStep[] = [
  offVariation,
  targetMatch,
  ruleMatch,
  rolloutSplit,
  defaultVariation,
];

export function evaluateFlag(
  flag: FlagConfig,
  context: EvalContext,
  segments: SegmentMap = {},
): FlagEvaluation {
  for (const step of steps) {
    const result = step(flag, context, segments);
    if (result) {
      return result;
    }
  }
  // defaultVariation always serves, so the loop cannot fall through.
  throw new Error(`flag "${flag.key}" evaluated no variation`);
}
