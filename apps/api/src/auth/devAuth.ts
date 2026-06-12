export type DevAuthEnv = {
  DEV_AUTH_ENABLED?: string;
};

/**
 * Dev personas exist only when the env opts in AND the request is hitting a
 * localhost host (mirrors ClawHub's isLocalDevAuthEnabled two-leg guard).
 * Production deploys never set DEV_AUTH_ENABLED, and even a misconfigured
 * deploy fails the localhost leg.
 */
export function isDevPersonaAuthEnabled(
  env: DevAuthEnv,
  requestUrl: string,
): boolean {
  if (env.DEV_AUTH_ENABLED !== "1") return false;
  return isLocalhostUrl(requestUrl);
}

function isLocalhostUrl(value: string): boolean {
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
