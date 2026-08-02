import { createKrillswitchEvaluator as createEvaluator } from "#evaluation";
import type {
  EvaluateFlagsOptions,
  FlagManifest,
  WidenManifest,
} from "./evaluation.js";

export type {
  EvaluateFlagsOptions,
  FlagManifest,
  WidenManifest,
} from "./evaluation.js";

export function createKrillswitchEvaluator<M extends FlagManifest>(
  rawManifest: M,
): (options: EvaluateFlagsOptions) => Promise<WidenManifest<M>> {
  return createEvaluator(rawManifest);
}
