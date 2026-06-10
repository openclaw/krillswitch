import {
  CONFIG_CACHE_TTL_MS,
  type FlagConfig,
} from "@openclaw/krillswitch-core";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { loadFlagConfigs, resolveEnvironmentId } from "./db/flagStore";

export interface EnvironmentConfig {
  environmentId: string;
  flags: FlagConfig[];
}

interface CacheEntry {
  fetchedAtMs: number;
  // The in-flight promise is cached (not its result) so a concurrent burst
  // of misses shares one D1 read instead of each going to the database.
  value: Promise<EnvironmentConfig | null>;
}

export interface ConfigLookup {
  /** Null when the eval key matches no environment. */
  config: EnvironmentConfig | null;
  source: "cache" | "d1";
}

// Module scope: lives for the isolate, never outlives CONFIG_CACHE_TTL_MS.
// Correctness must not depend on it — an empty cache falls through to D1.
const cache = new Map<string, CacheEntry>();

async function fetchEnvironmentConfig(
  db: DrizzleD1Database,
  evalKey: string,
): Promise<EnvironmentConfig | null> {
  const environmentId = await resolveEnvironmentId(db, evalKey);
  if (environmentId === null) {
    return null;
  }
  return { environmentId, flags: await loadFlagConfigs(db, environmentId) };
}

export async function getEnvironmentConfig(
  db: DrizzleD1Database,
  evalKey: string,
): Promise<ConfigLookup> {
  const nowMs = Date.now();
  const cached = cache.get(evalKey);
  if (cached && nowMs - cached.fetchedAtMs < CONFIG_CACHE_TTL_MS) {
    return { config: await cached.value, source: "cache" };
  }

  const value = fetchEnvironmentConfig(db, evalKey);
  cache.set(evalKey, { fetchedAtMs: nowMs, value });
  try {
    return { config: await value, source: "d1" };
  } catch (error) {
    // Don't cache failures; the next request retries D1.
    cache.delete(evalKey);
    throw error;
  }
}

export function clearConfigCache(): void {
  cache.clear();
}
