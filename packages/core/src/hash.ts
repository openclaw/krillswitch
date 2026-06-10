/**
 * Stable bucket in [0, 100) for percentage rollouts, hashing
 * `flagKey:contextKey` with FNV-1a 32-bit plus a murmur3-style final mix.
 * The final mix is required: bare FNV-1a maps near-identical keys (e.g.
 * consecutive GitHub user ids) into one narrow band. Plain TS (no Worker
 * or Node APIs) so server, SDK, and future in-process consumers bucket
 * identically — changing this function re-buckets every rollout.
 */
export function rolloutBucket(flagKey: string, contextKey: string): number {
  const input = `${flagKey}:${contextKey}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return ((hash >>> 0) / 0x1_0000_0000) * 100;
}
