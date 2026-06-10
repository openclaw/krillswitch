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

export function evaluateFlag(
  flag: FlagConfig,
  _context: EvalContext,
): FlagEvaluation {
  if (!flag.enabled) {
    const off = variationById(flag, flag.offVariationId);
    return { value: off.value, variationId: off.id, reason: { kind: "off" } };
  }
  const fallback = variationById(flag, flag.defaultVariationId);
  return {
    value: fallback.value,
    variationId: fallback.id,
    reason: { kind: "default" },
  };
}
