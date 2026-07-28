import type { AttributeValue } from "@openclaw/krillswitch-core";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createFlagEvaluator,
  type EvaluateFlagsOptions,
  type FlagManifest,
  mergeIntoManifest,
  requestEvaluation,
  type WidenManifest,
} from "./evaluation";

export interface FeatureFlagProviderProps<
  M extends FlagManifest = FlagManifest,
> {
  /** Public eval key identifying the project + environment flag set. */
  evalKey: string;
  /** Krillswitch service origin, e.g. https://krillswitch.example.workers.dev */
  baseUrl: string;
  /** Stable identity (GitHub user id). Falls back to a persisted anonymous key. */
  contextKey?: string;
  attributes?: Record<string, AttributeValue>;
  /** Server-evaluated values used for SSR and the matching hydration render. */
  initialValues?: Partial<M> | null;
  /** Background poll cadence; idle polls are ~free via ETag/304. */
  pollIntervalMs?: number;
  children: ReactNode;
}

const DEFAULT_POLL_INTERVAL_MS = 60_000;

export interface KrillswitchClient<M extends FlagManifest> {
  evaluateFlags: (options: EvaluateFlagsOptions) => Promise<M>;
  FeatureFlagProvider: (props: FeatureFlagProviderProps<M>) => ReactNode;
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

function readBootstrapValues<M extends FlagManifest>(
  manifest: M,
  initialValuesJson: string | null,
): M | null {
  if (initialValuesJson === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(initialValuesJson);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return mergeIntoManifest(manifest, parsed as Record<string, unknown>);
  } catch {
    return null;
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
  const evaluateFlags = createFlagEvaluator(manifest);

  function FeatureFlagProvider(props: FeatureFlagProviderProps<M>): ReactNode {
    const {
      evalKey,
      baseUrl,
      contextKey,
      attributes,
      initialValues,
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
    const initialValuesJson =
      initialValues === undefined
        ? null
        : JSON.stringify(initialValues ?? manifest);
    const bootstrapStorageKey = useRef<string | null>(storageKey);
    // Bootstrap belongs to the SSR/hydration identity only. Once this mounted
    // provider changes scope, it must use that scope's cache or defaults.
    const scopedInitialValuesJson =
      storageKey === bootstrapStorageKey.current ? initialValuesJson : null;
    const scopeKey = JSON.stringify([storageKey, scopedInitialValuesJson]);
    const [state, setState] = useState(() => ({
      scopeKey,
      values:
        readBootstrapValues(manifest, scopedInitialValuesJson) ??
        readCachedValues(manifest, storageKey),
    }));
    // A new identity or context must never render the previous scope's flags
    // while its fetch is still pending.
    const values =
      state.scopeKey === scopeKey
        ? state.values
        : (readBootstrapValues(manifest, scopedInitialValuesJson) ??
          readCachedValues(manifest, storageKey));

    useEffect(() => {
      let disposed = false;
      let activeController: AbortController | null = null;
      if (storageKey !== bootstrapStorageKey.current) {
        bootstrapStorageKey.current = null;
      }
      const parsedAttributes = JSON.parse(attributesJson) as Record<
        string,
        AttributeValue
      > | null;
      // Scoped to this identity/config; a refetch with the same tag can 304.
      let etag: string | null = null;
      setState((current) =>
        current.scopeKey === scopeKey
          ? current
          : {
              scopeKey,
              values:
                readBootstrapValues(manifest, scopedInitialValuesJson) ??
                readCachedValues(manifest, storageKey),
            },
      );

      // Single fetch path for mount, refocus, and poll.
      async function refresh(): Promise<void> {
        activeController?.abort();
        const controller = new AbortController();
        activeController = controller;
        try {
          const result = await requestEvaluation(
            manifest,
            {
              evalKey,
              baseUrl,
              context: {
                key: resolvedContextKey,
                ...(parsedAttributes ? { attributes: parsedAttributes } : {}),
              },
              signal: controller.signal,
            },
            etag,
          );
          if (
            disposed ||
            controller.signal.aborted ||
            result.kind === "not-modified"
          ) {
            return;
          }
          etag = result.etag;
          setState({ scopeKey, values: result.values });
          storageSet(storageKey, JSON.stringify(result.values));
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
      scopeKey,
      scopedInitialValuesJson,
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

  return {
    evaluateFlags,
    FeatureFlagProvider,
    useFeatureFlag,
    useFeatureFlags,
  };
}
