import { createKrillswitch } from "@openclaw/krillswitch-react";

// Mirrors the seeded clawhub development fixture; values are code defaults
// used before the first fetch and when the service is unreachable.
export const { FeatureFlagProvider, useFeatureFlag, useFeatureFlags } =
  createKrillswitch({
    souls: false,
    theme: "light",
    "rollout-demo": "a",
  });

export const KRILLSWITCH_URL: string =
  import.meta.env.VITE_KRILLSWITCH_URL ?? "http://localhost:8787";

export const KRILLSWITCH_EVAL_KEY: string =
  import.meta.env.VITE_KRILLSWITCH_EVAL_KEY ?? "ks_clawhub_development_local";
