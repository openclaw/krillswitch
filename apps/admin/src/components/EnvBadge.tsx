/** Environment identity. Every place an environment appears uses the same
 *  tone so operators always know where a change lands: production reads as
 *  danger, staging-like as warning, development-like as info. The mapping is
 *  a naming heuristic (environments carry no role field); unknown names stay
 *  neutral instead of guessing. */
const PRODUCTION_PATTERN = /^(prod|production|live)([-_].*)?$/i;
const STAGING_PATTERN =
  /^(stag(e|ing)?|preprod|pre-prod|qa|test(ing)?|uat)([-_].*)?$/i;
const DEVELOPMENT_PATTERN = /^(dev(elopment)?|local|sandbox|demo)([-_].*)?$/i;

export function isProductionEnv(key: string): boolean {
  return PRODUCTION_PATTERN.test(key);
}

function envTone(key: string): "error" | "warning" | "info" | "neutral" {
  if (PRODUCTION_PATTERN.test(key)) return "error";
  if (STAGING_PATTERN.test(key)) return "warning";
  if (DEVELOPMENT_PATTERN.test(key)) return "info";
  return "neutral";
}

export function EnvBadge({
  envKey,
  name,
  className,
}: {
  envKey: string;
  /** Display name when it differs from the key (defaults to the key). */
  name?: string;
  className?: string;
}) {
  const classes = ["oc-badge", `oc-badge-${envTone(envKey)}`, "env-badge"];
  if (className) classes.push(className);
  return <span className={classes.join(" ")}>{name ?? envKey}</span>;
}
