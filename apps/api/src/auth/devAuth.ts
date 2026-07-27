export type DevAuthEnv = {
  DEV_AUTH_ENABLED?: string;
  BETTER_AUTH_URL?: string;
};

/**
 * Dev personas exist only when the env opts in AND the deployment is local
 * (mirrors ClawHub's isLocalDevAuthEnabled two-leg guard). Production deploys
 * never set DEV_AUTH_ENABLED, and even a misconfigured deploy fails leg two.
 *
 * Locality cannot be read from the request URL alone: `wrangler dev` serves the
 * worker under its configured production route, so `c.req.url` is the public
 * host even on a laptop. The deployment's own configured base URL is the
 * reliable signal — it only points at localhost in local development, and a
 * production deploy pointing there would have broken auth anyway.
 */
export function isDevPersonaAuthEnabled(
  env: DevAuthEnv,
  requestUrl: string,
): boolean {
  if (env.DEV_AUTH_ENABLED !== "1") return false;
  return isLocalhostUrl(requestUrl) || isLocalhostUrl(env.BETTER_AUTH_URL);
}

function isLocalhostUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const { hostname } = new URL(value);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}
