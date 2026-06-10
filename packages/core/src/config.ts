/**
 * How long a Worker isolate may serve flag configs without re-reading D1.
 * Bounds propagation: a flag change is visible everywhere within this window.
 * Referenced by the API cache, benchmarks, and docs — change it here only.
 */
export const CONFIG_CACHE_TTL_MS = 1000;
