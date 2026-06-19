import {
  CONFIG_CACHE_TTL_MS,
  type FlagConfig,
} from "@openclaw/krillswitch-core";
import { drizzle } from "drizzle-orm/d1";
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
// Keep this bounded: eval keys come from requests, so an unbounded map would
// let random invalid keys grow an isolate indefinitely.
const MAX_CONFIG_CACHE_ENTRIES = 512;
const cache = new Map<string, CacheEntry>();

async function fetchEnvironmentConfig(
  db: D1Database,
  evalKey: string,
): Promise<EnvironmentConfig | null> {
  // Anchor each refresh at the primary, then allow D1 to serve later queries
  // from a replica only once it can satisfy the session bookmark. Drizzle's
  // D1 client type predates D1DatabaseSession, but both expose prepare/batch.
  const session = db.withSession("first-primary");
  const sessionDb = drizzle(session as unknown as D1Database);
  const environmentId = await resolveEnvironmentId(sessionDb, evalKey);
  if (environmentId === null) {
    return null;
  }
  return {
    environmentId,
    flags: await loadFlagConfigs(sessionDb, environmentId),
  };
}

export async function getEnvironmentConfig(
  db: D1Database,
  evalKey: string,
): Promise<ConfigLookup> {
  const nowMs = Date.now();
  const cached = cache.get(evalKey);
  if (cached && nowMs - cached.fetchedAtMs < CONFIG_CACHE_TTL_MS) {
    // Map iteration order is LRU order. Promote hot keys without extending
    // their freshness window.
    cache.delete(evalKey);
    cache.set(evalKey, cached);
    return { config: await cached.value, source: "cache" };
  }

  const value = fetchEnvironmentConfig(db, evalKey);
  cache.delete(evalKey);
  cache.set(evalKey, { fetchedAtMs: nowMs, value });
  evictCacheEntries(nowMs);
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

function evictCacheEntries(nowMs: number): void {
  for (const [key, entry] of cache) {
    if (nowMs - entry.fetchedAtMs < CONFIG_CACHE_TTL_MS) {
      continue;
    }
    cache.delete(key);
  }
  while (cache.size > MAX_CONFIG_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}
