import { type ParsedArgs, requireFlag } from "../args";
import type { KrillswitchClient } from "../client";
import { type Column, cell, printJson, printTable, wantsJson } from "../output";

type FlagListEntry = {
  key: string;
  name: string;
  kind: string;
  enabled: boolean;
};

type FlagDetail = {
  flag: { key: string; name: string; kind: string; description: string | null };
  variations: { id: string; value: unknown; name: string | null }[];
  config: {
    enabled: boolean;
    offVariationId: string;
    defaultVariationId: string;
    targets: unknown[];
    rules: unknown[];
    rollout: unknown;
  };
};

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
