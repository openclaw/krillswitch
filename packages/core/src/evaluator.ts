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
// stable hash of flagKey + contextKey in the percentage-rollout slice.
const rolloutSplit: EvaluationStep = (flag) => {
  const first = flag.rollout?.variations[0];
  return first ? serve(flag, first.variationId, { kind: "rollout" }) : null;
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
