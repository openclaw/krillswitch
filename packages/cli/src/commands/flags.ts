import type { FlagKind, JsonValue } from "@openclaw/krillswitch-core";
import {
  CliUsageError,
  flag,
  flagAll,
  type ParsedArgs,
  requireFlag,
} from "../args";
import type { KrillswitchClient } from "../client";
import { type Column, cell, printJson, printTable, wantsJson } from "../output";

type FlagListEntry = {
  key: string;
  name: string;
  kind: string;
  enabled: boolean;
};

type Variation = { id: string; value: JsonValue; name: string | null };

type FlagDetail = {
  flag: {
    key: string;
    name: string;
    kind: FlagKind;
    description: string | null;
  };
  variations: Variation[];
  config: {
    enabled: boolean;
    offVariationId: string;
    defaultVariationId: string;
    targets: { variationId: string; contextKeys: string[] }[];
    rules: {
      variationId: string;
      attribute: string;
      values: (string | number | boolean)[];
    }[];
    rollout: { variations: { variationId: string; weight: number }[] } | null;
  };
};

const KINDS: FlagKind[] = ["boolean", "string", "number", "json"];

function parseKind(raw: string): FlagKind {
  const kind = KINDS.find((candidate) => candidate === raw);
  if (!kind) {
    throw new CliUsageError(`--kind must be one of ${KINDS.join(", ")}`);
  }
  return kind;
}

function parseValueForKind(kind: FlagKind, raw: string): JsonValue {
  switch (kind) {
    case "boolean":
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new CliUsageError(
        `boolean variation must be true/false, got "${raw}"`,
      );
    case "number": {
      const value = Number(raw);
      if (raw.trim() === "" || Number.isNaN(value)) {
        throw new CliUsageError(
          `number variation must be numeric, got "${raw}"`,
        );
      }
      return value;
    }
    case "json":
      try {
        return JSON.parse(raw) as JsonValue;
      } catch {
        throw new CliUsageError(
          `json variation must be valid JSON, got "${raw}"`,
        );
      }
    case "string":
      return raw;
  }
}

const LIST_COLUMNS: Column<FlagListEntry>[] = [
  { header: "KEY", value: (f) => f.key },
  { header: "NAME", value: (f) => f.name },
  { header: "KIND", value: (f) => f.kind },
  { header: "STATE", value: (f) => (f.enabled ? "on" : "off") },
];

function flagsBase(args: ParsedArgs): string {
  const project = requireFlag(args, "project");
  const env = requireFlag(args, "env");
  return `/admin/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(env)}/flags`;
}

export async function flagsList(
  client: KrillswitchClient,
  args: ParsedArgs,
): Promise<void> {
  const { flags } = await client.request<{ flags: FlagListEntry[] }>(
    flagsBase(args),
  );
  if (wantsJson(args)) {
    printJson({ flags });
    return;
  }
  printTable(flags, LIST_COLUMNS);
}

export async function flagsGet(
  client: KrillswitchClient,
  args: ParsedArgs,
  flagKey: string,
): Promise<void> {
  const detail = await client.request<FlagDetail>(
    `${flagsBase(args)}/${encodeURIComponent(flagKey)}`,
  );
  if (wantsJson(args)) {
    printJson(detail);
    return;
  }
  process.stdout.write(`${detail.flag.name}  (${detail.flag.key})\n`);
  process.stdout.write(`  kind: ${detail.flag.kind}\n`);
  process.stdout.write(`  enabled: ${detail.config.enabled ? "on" : "off"}\n`);
  printTable(detail.variations, [
    { header: "VARIATION", value: (v) => v.name ?? v.id },
    { header: "VALUE", value: (v) => cell(v.value) },
    {
      header: "ROLE",
      value: (v) =>
        [
          v.id === detail.config.defaultVariationId ? "default" : "",
          v.id === detail.config.offVariationId ? "off" : "",
        ]
          .filter(Boolean)
          .join(",") || "—",
    },
  ]);
}

export async function flagsToggle(
  client: KrillswitchClient,
  args: ParsedArgs,
  flagKey: string,
): Promise<void> {
  const on = args.booleans.has("on");
  const off = args.booleans.has("off");
  if (on === off) {
    throw new CliUsageError("flags toggle needs exactly one of --on / --off");
  }
  const result = await client.request<{ flag: FlagListEntry }>(
    `${flagsBase(args)}/${encodeURIComponent(flagKey)}`,
    { method: "PATCH", body: { enabled: on } },
  );
  if (wantsJson(args)) {
    printJson(result);
    return;
  }
  process.stdout.write(`${flagKey}: ${result.flag.enabled ? "on" : "off"}\n`);
}

type CreateBody = {
  key: string;
  name: string;
  kind: FlagKind;
  variations: { value: JsonValue; name: string | null }[];
  defaultVariationIndex: number;
  offVariationIndex: number;
  enabled: boolean;
};

export async function flagsCreate(
  client: KrillswitchClient,
  args: ParsedArgs,
  flagKey: string,
): Promise<void> {
  const project = requireFlag(args, "project");
  const kind = parseKind(requireFlag(args, "kind"));
  const name = flag(args, "name") ?? flagKey;

  const rawVariations = flagAll(args, "variation");
  // Boolean flags default to on/off when no variations are given.
  const variations =
    rawVariations.length > 0
      ? rawVariations.map((raw) => ({
          value: parseValueForKind(kind, raw),
          name: null,
        }))
      : kind === "boolean"
        ? [
            { value: true, name: "On" },
            { value: false, name: "Off" },
          ]
        : [];
  if (variations.length === 0) {
    throw new CliUsageError(`--variation is required for ${kind} flags`);
  }

  const body: CreateBody = {
    key: flagKey,
    name,
    kind,
    variations,
    defaultVariationIndex: Number(flag(args, "default-index") ?? "0"),
    offVariationIndex: Number(
      flag(args, "off-index") ?? String(variations.length - 1),
    ),
    enabled: args.booleans.has("enabled"),
  };
  const result = await client.request<{ created: string }>(
    `/admin/projects/${encodeURIComponent(project)}/flags`,
    { method: "POST", body },
  );
  if (wantsJson(args)) {
    printJson(result);
    return;
  }
  process.stdout.write(`created ${result.created}\n`);
}

type TargetingSpec = {
  allowlist?: { variationIndex: number; contextKeys: string[] }[];
  rules?: {
    variationIndex: number;
    attribute: string;
    values: (string | number | boolean)[];
  }[];
  split?: { variationIndex: number; weight: number }[] | null;
};

type UpdateBody = {
  enabled: boolean;
  variations: { id?: string; value: JsonValue; name: string | null }[];
  offVariationIndex: number;
  defaultVariationIndex: number;
  targets: { variationIndex: number; contextKeys: string[] }[];
  rules: {
    variationIndex: number;
    attribute: string;
    values: (string | number | boolean)[];
  }[];
  rollout: { variations: { variationIndex: number; weight: number }[] } | null;
};

function readSpec(args: ParsedArgs): TargetingSpec {
  const inline = flag(args, "targeting");
  if (inline === undefined) {
    throw new CliUsageError(
      "flags targeting set needs --targeting '<json>' (allowlist/rules/split)",
    );
  }
  try {
    return JSON.parse(inline) as TargetingSpec;
  } catch {
    throw new CliUsageError("--targeting must be valid JSON");
  }
}

// Replaces the environment's targeting wholesale from the spec, preserving the
// flag's variations and its default/off selection. Omitted spec keys clear
// that dimension — read `flags get --json` first to preserve existing rules.
export async function flagsTargetingSet(
  client: KrillswitchClient,
  args: ParsedArgs,
  flagKey: string,
): Promise<void> {
  const spec = readSpec(args);
  const base = `${flagsBase(args)}/${encodeURIComponent(flagKey)}`;
  const detail = await client.request<FlagDetail>(base);

  const indexOfId = (id: string) =>
    Math.max(
      0,
      detail.variations.findIndex((v) => v.id === id),
    );

  const body: UpdateBody = {
    enabled: detail.config.enabled,
    variations: detail.variations.map((v) => ({
      id: v.id,
      value: v.value,
      name: v.name,
    })),
    offVariationIndex: indexOfId(detail.config.offVariationId),
    defaultVariationIndex: indexOfId(detail.config.defaultVariationId),
    targets: spec.allowlist ?? [],
    rules: spec.rules ?? [],
    rollout: spec.split ? { variations: spec.split } : null,
  };

  const result = await client.request<FlagDetail>(base, {
    method: "PUT",
    body,
  });
  if (wantsJson(args)) {
    printJson(result);
    return;
  }
  process.stdout.write(`targeting updated for ${flagKey}\n`);
}
