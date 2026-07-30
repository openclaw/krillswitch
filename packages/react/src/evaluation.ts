import type {
  EvalContext,
  EvalRequestBody,
  FlagValue,
} from "@openclaw/krillswitch-core";

/** Per-app flag declaration: key -> code default. */
export type FlagManifest = Record<string, FlagValue>;

type WidenFlagValue<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : FlagValue;

/** Converts inline literal defaults into the values a remote flag may serve. */
export type WidenManifest<M extends FlagManifest> = {
  [K in keyof M]: WidenFlagValue<M[K]>;
};

export interface EvaluateFlagsOptions {
  /** Public eval key identifying the project and environment flag set. */
  evalKey: string;
  /** Krillswitch service origin, e.g. https://flags.openclaw.ai. */
  baseUrl: string;
  /** Explicit stable identity and optional targeting attributes. */
  context: EvalContext;
  /** Cancellation or application-defined timeout signal. */
  signal?: AbortSignal;
}

type EvaluationResponse<M extends FlagManifest> =
  | { kind: "not-modified" }
  | { kind: "values"; values: M; etag: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A remote value is only trusted while its type still matches the manifest. */
function matchesManifestType(defaultValue: FlagValue, value: unknown): boolean {
  if (typeof defaultValue === "object") {
    // JSON-kind flags may contain any JSON value, all of which survive parsing.
    return value !== undefined;
  }
  return typeof value === typeof defaultValue;
}

export function mergeIntoManifest<M extends FlagManifest>(
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
  // Every assigned key and value was validated against the manifest above.
  return merged as M;
}

function parseRemoteValues(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || !isRecord(payload.flags)) {
    throw new Error("Krillswitch evaluation returned an invalid response");
  }

  const values: Record<string, unknown> = {};
  for (const [key, flag] of Object.entries(payload.flags)) {
    if (!isRecord(flag) || !("value" in flag)) {
      throw new Error("Krillswitch evaluation returned an invalid flag");
    }
    values[key] = flag.value;
  }
  return values;
}

function evaluationUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/eval`;
}

export async function requestEvaluation<M extends FlagManifest>(
  manifest: M,
  options: EvaluateFlagsOptions,
  etag?: string | null,
): Promise<EvaluationResponse<M>> {
  const body: EvalRequestBody = { context: options.context };
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.evalKey}`,
    "content-type": "application/json",
  };
  if (etag) {
    headers["if-none-match"] = etag;
  }

  const response = await fetch(evaluationUrl(options.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (response.status === 304) {
    return { kind: "not-modified" };
  }
  if (!response.ok) {
    throw new Error(
      `Krillswitch evaluation failed with status ${response.status}`,
    );
  }

  const payload: unknown = await response.json();
  return {
    kind: "values",
    values: mergeIntoManifest(manifest, parseRemoteValues(payload)),
    etag: response.headers.get("etag"),
  };
}

export function createFlagEvaluator<M extends FlagManifest>(
  manifest: M,
): (options: EvaluateFlagsOptions) => Promise<M> {
  return async (options) => {
    const result = await requestEvaluation(manifest, options);
    if (result.kind === "not-modified") {
      throw new Error("Krillswitch evaluation returned an unexpected 304");
    }
    return result.values;
  };
}

/** Creates a manifest-typed evaluator without importing React. */
export function createKrillswitchEvaluator<M extends FlagManifest>(
  rawManifest: M,
): (options: EvaluateFlagsOptions) => Promise<WidenManifest<M>> {
  // Literal defaults are valid members of their widened primitive types.
  return createFlagEvaluator(rawManifest as FlagManifest as WidenManifest<M>);
}
