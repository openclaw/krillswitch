import type {
  AttributeValue,
  EvalRequestBody,
  EvalResponseBody,
  FlagValue,
} from "@openclaw/krillswitch-core";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** Per-app flag declaration: key → code default. Value types drive the hooks. */
export type FlagManifest = Record<string, FlagValue>;

type WidenFlagValue<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T;

/**
 * Inline manifest literals infer literal types (`souls: false` → `false`);
 * hooks must report the wider primitive since the server can serve any
 * variation of that type.
 */
export type WidenManifest<M extends FlagManifest> = {
  [K in keyof M]: WidenFlagValue<M[K]>;
};

export interface FeatureFlagProviderProps {
  /** Public eval key identifying the project + environment flag set. */
  evalKey: string;
  /** Krillswitch service origin, e.g. https://krillswitch.example.workers.dev */
  baseUrl: string;
  /** Stable identity (GitHub user id). Falls back to a persisted anonymous key. */
  contextKey?: string;
  attributes?: Record<string, AttributeValue>;
  /** Background poll cadence; idle polls are ~free via ETag/304. */
  pollIntervalMs?: number;
  children: ReactNode;
}

const DEFAULT_POLL_INTERVAL_MS = 60_000;

export interface KrillswitchClient<M extends FlagManifest> {
  FeatureFlagProvider: (props: FeatureFlagProviderProps) => ReactNode;
  useFeatureFlag: <K extends Extract<keyof M, string>>(key: K) => M[K];
  useFeatureFlags: () => M;
}

export const ANONYMOUS_KEY_STORAGE_KEY = "krillswitch.anonymousKey";

export function flagValuesStorageKey(
  evalKey: string,
  contextKey?: string,
  attributesJson?: string,
): string {
  const base = `krillswitch.flags.${evalKey}`;
  if (contextKey === undefined && attributesJson === undefined) {
    return base;
  }
  return `${base}.${encodeURIComponent(
    JSON.stringify([contextKey, attributesJson ?? null]),
  )}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function storageGet(key: string): string | null {
  try {
    return safeStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    safeStorage()?.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or quota-constrained contexts.
  }
}

/** A cached value is only trusted while its type still matches the manifest. */
function matchesManifestType(defaultValue: FlagValue, value: unknown): boolean {
  if (typeof defaultValue === "object") {
    // json-kind flag (object, array, or null default): any JSON value is valid.
    return value !== undefined;
  }
  return typeof value === typeof defaultValue;
}

function mergeIntoManifest<M extends FlagManifest>(
  manifest: M,
  candidate: Record<string, unknown>,
): M {
  const merged: FlagManifest = { ...manifest };
  for (const [key, defaultValue] of Object.entries(manifest)) {
    const value = candidate[key];
    if (value !== undefined && matchesManifestType(defaultValue, value)) {
      merged[key] = value as FlagValue;
    }
  }
  // Keys and value types were validated against the manifest above.
  return merged as M;
}

function readCachedValues<M extends FlagManifest>(
  manifest: M,
  storageKey: string,
): M {
  const raw = storageGet(storageKey);
  if (!raw) {
    return manifest;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      return manifest;
    }
    return mergeIntoManifest(manifest, parsed as Record<string, unknown>);
  } catch {
    return manifest;
  }
}

function anonymousContextKey(): string {
  const existing = storageGet(ANONYMOUS_KEY_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const generated = `anon-${crypto.randomUUID()}`;
  storageSet(ANONYMOUS_KEY_STORAGE_KEY, generated);
  return generated;
}

export function createKrillswitch<M extends FlagManifest>(
  rawManifest: M,
): KrillswitchClient<WidenManifest<M>> {
  // Literal defaults are valid members of their widened primitive types.
  return createClient(rawManifest as FlagManifest as WidenManifest<M>);
}

function createClient<M extends FlagManifest>(
  manifest: M,
): KrillswitchClient<M> {
  const FlagContext = createContext<M>(manifest);

  function FeatureFlagProvider(props: FeatureFlagProviderProps): ReactNode {
    const {
      evalKey,
      baseUrl,
      contextKey,
      attributes,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
      children,
    } = props;
    const anonymousKey = useRef<string | null>(null);
    if (contextKey === undefined && anonymousKey.current === null) {
      anonymousKey.current =
        typeof window === "undefined" ? "anonymous" : anonymousContextKey();
    }
    const resolvedContextKey =
      contextKey ?? anonymousKey.current ?? "anonymous";
    // Serialized so a new-but-equal attributes object doesn't refetch.
    const attributesJson = JSON.stringify(attributes ?? null);
    const storageKey = flagValuesStorageKey(
      evalKey,
      resolvedContextKey,
      attributesJson,
    );
    const [state, setState] = useState(() => ({
      storageKey,
      values: readCachedValues(manifest, storageKey),
    }));
    // A new identity or context must never render the previous scope's flags
    // while its fetch is still pending.
    const values =
      state.storageKey === storageKey
        ? state.values
        : readCachedValues(manifest, storageKey);

    useEffect(() => {
      let disposed = false;
      let activeController: AbortController | null = null;
      const parsedAttributes = JSON.parse(attributesJson) as Record<
        string,
        AttributeValue
      > | null;
      // Scoped to this identity/config; a refetch with the same tag can 304.
      let etag: string | null = null;
      setState({
        storageKey,
        values: readCachedValues(manifest, storageKey),
      });

      // Single fetch path for mount, refocus, and poll.
      async function refresh(): Promise<void> {
        activeController?.abort();
        const controller = new AbortController();
        activeController = controller;
        try {
          const body: EvalRequestBody = {
            context: {
              key: resolvedContextKey,
              ...(parsedAttributes ? { attributes: parsedAttributes } : {}),
            },
          };
          const headers: Record<string, string> = {
            authorization: `Bearer ${evalKey}`,
            "content-type": "application/json",
          };
          if (etag) {
            headers["if-none-match"] = etag;
          }
          const response = await fetch(`${baseUrl}/v1/eval`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (
            disposed ||
            controller.signal.aborted ||
            response.status === 304 ||
            !response.ok
          ) {
            return;
          }
          etag = response.headers.get("etag");
          const payload = (await response.json()) as EvalResponseBody;
          const remoteValues = Object.fromEntries(
            Object.entries(payload.flags).map(([key, flag]) => [
              key,
              flag.value,
            ]),
          );
          const merged = mergeIntoManifest(manifest, remoteValues);
          setState({ storageKey, values: merged });
          storageSet(storageKey, JSON.stringify(merged));
        } catch {
          // Unreachable service: keep rendering last-known values.
        } finally {
          if (activeController === controller) {
            activeController = null;
          }
        }
      }

      void refresh();
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          void refresh();
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      const pollTimer = setInterval(() => void refresh(), pollIntervalMs);

      return () => {
        disposed = true;
        activeController?.abort();
        clearInterval(pollTimer);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      };
    }, [
      evalKey,
      baseUrl,
      resolvedContextKey,
      attributesJson,
      pollIntervalMs,
      storageKey,
    ]);

    const value = useMemo(() => values, [values]);
    return (
      <FlagContext.Provider value={value}>{children}</FlagContext.Provider>
    );
  }

  function useFeatureFlags(): M {
    return useContext(FlagContext);
  }

  function useFeatureFlag<K extends Extract<keyof M, string>>(key: K): M[K] {
    return useFeatureFlags()[key];
  }

  return { FeatureFlagProvider, useFeatureFlag, useFeatureFlags };
}
