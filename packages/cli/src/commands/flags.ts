import type { FlagKind, JsonValue } from "@openclaw/krillswitch-core";
import type { KrillswitchClient } from "../client";
import { CliUsageError } from "../errors";
import type {
  FlagsCreateOptions,
  FlagsTargetingOptions,
  FlagsToggleOptions,
  ProjectEnvOptions,
} from "../options";
import {
  type Column,
  cell,
  printJson,
  printKeyValues,
  printTable,
  wantsJson,
} from "../output";

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
      if (raw.trim() === "" || !Number.isFinite(value)) {
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

function flagsBase(options: ProjectEnvOptions): string {
  const { project, env } = options;
  return `/admin/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(env)}/flags`;
}

export async function flagsList(
  client: KrillswitchClient,
  options: ProjectEnvOptions,
): Promise<void> {
  const { flags } = await client.request<{ flags: FlagListEntry[] }>(
    flagsBase(options),
  );
  if (wantsJson(options)) {
    printJson({ flags });
    return;
  }
  printTable(flags, LIST_COLUMNS, { title: "Flags" });
}

export async function flagsGet(
  client: KrillswitchClient,
  options: ProjectEnvOptions,
  flagKey: string,
): Promise<void> {
  const detail = await client.request<FlagDetail>(
    `${flagsBase(options)}/${encodeURIComponent(flagKey)}`,
  );
  if (wantsJson(options)) {
    printJson(detail);
    return;
  }
  printKeyValues(detail.flag.name, [
    ["key", detail.flag.key],
    ["kind", detail.flag.kind],
    ["state", detail.config.enabled ? "on" : "off"],
  ]);
  process.stdout.write("\n");
  printFlagVariations(detail);
}

function printFlagVariations(detail: FlagDetail): void {
  const rows = detail.variations.map((variation, index) => ({
    number: index + 1,
    variation,
  }));
  const hasNames = rows.some((row) => row.variation.name !== null);
  const columns: Column<(typeof rows)[number]>[] = [
    {
      header: "ROLE",
      value: (row) => variationRoleLabel(row, detail),
    },
    ...(hasNames
      ? [
          {
            header: "NAME",
            value: (row: (typeof rows)[number]) =>
              row.variation.name ?? cell(null),
          },
        ]
      : []),
    {
      header: "VALUE",
      value: (row) => cell(row.variation.value),
    },
  ];
  printTable(rows, columns, { title: "Variations" });
}

function variationRoleLabel(
  row: { number: number; variation: Variation },
  detail: FlagDetail,
): string {
  const role = variationRole(row.variation, detail);
  return role ?? `option ${row.number}`;
}

function variationRole(
  variation: Variation,
  detail: FlagDetail,
): string | null {
  const roles = [
    variation.id === detail.config.defaultVariationId ? "default" : "",
    variation.id === detail.config.offVariationId ? "off" : "",
  ].filter(Boolean);
  return roles.length > 0 ? roles.join(", ") : null;
}

export async function flagsToggle(
  client: KrillswitchClient,
  options: FlagsToggleOptions,
  flagKey: string,
): Promise<void> {
  const { on, off } = options;
  if (on === off) {
    throw new CliUsageError(
      [
        "flags toggle needs exactly one of --on / --off",
        "Usage: krillswitch flags toggle <key> -p <project> -e <env> --on|--off",
      ].join("\n"),
    );
  }
  const result = await client.request<{ flag: FlagListEntry }>(
    `${flagsBase(options)}/${encodeURIComponent(flagKey)}`,
    { method: "PATCH", body: { enabled: on } },
  );
  if (wantsJson(options)) {
    printJson(result);
    return;
  }
  printTable(
    [{ key: flagKey, state: result.flag.enabled ? "on" : "off" }],
    [
      { header: "KEY", value: (row) => row.key },
      { header: "STATE", value: (row) => row.state },
    ],
    { title: "Flag updated" },
  );
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
  options: FlagsCreateOptions,
  flagKey: string,
): Promise<void> {
  const { project } = options;
  const kind = parseKind(options.kind);
  const name = options.name ?? flagKey;

  // Boolean flags default to on/off when no variations are given.
  const variations =
    options.variations.length > 0
      ? options.variations.map((raw) => ({
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
    throw new CliUsageError(
      [
        `${kind} flags need at least one --variation`,
        `Example: krillswitch flags create ${flagKey} -p ${project} --kind ${kind} --variation ${exampleVariation(kind)}`,
      ].join("\n"),
    );
  }

  const body: CreateBody = {
    key: flagKey,
    name,
    kind,
    variations,
    defaultVariationIndex: Number(options.defaultIndex ?? "0"),
    offVariationIndex: Number(
      options.offIndex ?? String(variations.length - 1),
    ),
    enabled: options.enabled,
  };
  const result = await client.request<{ created: string }>(
    `/admin/projects/${encodeURIComponent(project)}/flags`,
    { method: "POST", body },
  );
  if (wantsJson(options)) {
    printJson(result);
    return;
  }
  printKeyValues("Flag created", [["key", result.created]]);
}

function exampleVariation(kind: FlagKind): string {
  switch (kind) {
    case "number":
      return "100";
    case "json":
      return '\'{"tier":"beta"}\'';
    case "boolean":
      return "true";
    case "string":
      return "minimal";
  }
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

function readSpec(options: FlagsTargetingOptions): TargetingSpec {
  try {
    return JSON.parse(options.targeting) as TargetingSpec;
  } catch {
    throw new CliUsageError("--targeting must be valid JSON");
  }
}

// Replaces the environment's targeting wholesale from the spec, preserving the
// flag's variations and its default/off selection. Omitted spec keys clear
// that dimension. Read `flags get --json` first to preserve existing rules.
export async function flagsTargetingSet(
  client: KrillswitchClient,
  options: FlagsTargetingOptions,
  flagKey: string,
): Promise<void> {
  const spec = readSpec(options);
  const base = `${flagsBase(options)}/${encodeURIComponent(flagKey)}`;
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
  if (wantsJson(options)) {
    printJson(result);
    return;
  }
  printKeyValues("Targeting updated", [["key", flagKey]]);
}
