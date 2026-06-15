import { flag, type ParsedArgs } from "../args";
import type { KrillswitchClient } from "../client";
import { type Column, cell, printJson, printTable, wantsJson } from "../output";

type ChangeLogEntry = {
  actorName: string;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  createdAt: number;
};

const COLUMNS: Column<ChangeLogEntry>[] = [
  { header: "WHEN", value: (e) => new Date(e.createdAt).toISOString() },
  { header: "ACTOR", value: (e) => e.actorName },
  { header: "ACTION", value: (e) => e.action },
  { header: "TARGET", value: (e) => e.target },
  {
    header: "CHANGE",
    value: (e) =>
      e.before == null && e.after == null
        ? "—"
        : `${cell(e.before)} -> ${cell(e.after)}`,
  },
];

export async function logTail(
  client: KrillswitchClient,
  args: ParsedArgs,
): Promise<void> {
  const params = new URLSearchParams();
  const flagKey = flag(args, "flag");
  const project = flag(args, "project");
  if (flagKey) params.set("flagKey", flagKey);
  if (project) params.set("projectKey", project);
  const query = params.toString();

  const { entries } = await client.request<{ entries: ChangeLogEntry[] }>(
    `/admin/changelog${query ? `?${query}` : ""}`,
  );
  const limit = Number(flag(args, "limit") ?? "20");
  const tail = entries.slice(0, Number.isFinite(limit) ? limit : 20);

  if (wantsJson(args)) {
    printJson({ entries: tail });
    return;
  }
  printTable(tail, COLUMNS);
}
