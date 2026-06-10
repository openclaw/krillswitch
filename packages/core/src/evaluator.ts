import { rolloutBucket } from "./hash";
import type {
  EvalContext,
  FlagConfig,
  FlagEvaluation,
  Variation,
} from "./types";

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
) => FlagEvaluation | null;

const offVariation: EvaluationStep = (flag) =>
  flag.enabled ? null : serve(flag, flag.offVariationId, { kind: "off" });

const targetMatch: EvaluationStep = (flag, context) => {
  const target = flag.targets.find((t) => t.contextKeys.includes(context.key));
  return target ? serve(flag, target.variationId, { kind: "target" }) : null;
};

const ruleMatch: EvaluationStep = (flag, context) => {
  const attributes = context.attributes;
  if (!attributes) {
    return null;
  }
  const rule = flag.rules.find((r) => {
    const actual = attributes[r.attribute];
    return actual !== undefined && r.values.includes(actual);
  });
  return rule
    ? serve(flag, rule.variationId, { kind: "rule", attribute: rule.attribute })
    : null;
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
): FlagEvaluation {
  for (const step of steps) {
    const result = step(flag, context);
    if (result) {
      return result;
    }
  }
  // defaultVariation always serves, so the loop cannot fall through.
  throw new Error(`flag "${flag.key}" evaluated no variation`);
}
