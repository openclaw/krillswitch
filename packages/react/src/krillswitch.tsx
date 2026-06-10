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
  children: ReactNode;
}

export interface KrillswitchClient<M extends FlagManifest> {
  FeatureFlagProvider: (props: FeatureFlagProviderProps) => ReactNode;
  useFeatureFlag: <K extends Extract<keyof M, string>>(key: K) => M[K];
  useFeatureFlags: () => M;
}

export const ANONYMOUS_KEY_STORAGE_KEY = "krillswitch.anonymousKey";

export function flagValuesStorageKey(evalKey: string): string {
  return `krillswitch.flags.${evalKey}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
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
  evalKey: string,
): M {
  const storage = safeStorage();
  const raw = storage?.getItem(flagValuesStorageKey(evalKey));
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
  const storage = safeStorage();
  const existing = storage?.getItem(ANONYMOUS_KEY_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const generated = `anon-${crypto.randomUUID()}`;
  storage?.setItem(ANONYMOUS_KEY_STORAGE_KEY, generated);
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
    const { evalKey, baseUrl, contextKey, attributes, children } = props;
    // First paint: last-known values, manifest defaults on a cold profile.
    const [values, setValues] = useState<M>(() =>
      readCachedValues(manifest, evalKey),
    );
    // Serialized so a new-but-equal attributes object doesn't refetch.
    const attributesJson = JSON.stringify(attributes ?? null);

    useEffect(() => {
      const controller = new AbortController();
      const parsedAttributes = JSON.parse(attributesJson) as Record<
        string,
        AttributeValue
      > | null;

      async function refresh(): Promise<void> {
        const body: EvalRequestBody = {
          context: {
            key: contextKey ?? anonymousContextKey(),
            ...(parsedAttributes ? { attributes: parsedAttributes } : {}),
          },
        };
        const response = await fetch(`${baseUrl}/v1/eval`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${evalKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as EvalResponseBody;
        const remoteValues = Object.fromEntries(
          Object.entries(payload.flags).map(([key, flag]) => [key, flag.value]),
        );
        const merged = mergeIntoManifest(manifest, remoteValues);
        setValues(merged);
        safeStorage()?.setItem(
          flagValuesStorageKey(evalKey),
          JSON.stringify(merged),
        );
      }

      refresh().catch(() => {
        // Unreachable service: keep rendering last-known values.
      });
      return () => controller.abort();
    }, [evalKey, baseUrl, contextKey, attributesJson]);

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
