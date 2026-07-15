import type { KrillswitchClient } from "../client";
import { CliUsageError } from "../errors";
import type { LogTailOptions } from "../options";
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
        ? "none"
        : `${cell(e.before)} to ${cell(e.after)}`,
  },
];

export async function logTail(
  client: KrillswitchClient,
  options: LogTailOptions,
): Promise<void> {
  const limit = Number(options.limit ?? "20");
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
    throw new CliUsageError("--limit must be an integer from 0 to 100");
  }
  const params = new URLSearchParams();
  if (options.flagKey) params.set("flagKey", options.flagKey);
  if (options.project) params.set("projectKey", options.project);
  params.set("limit", String(Math.max(1, limit)));
  const query = params.toString();

  const { entries } = await client.request<{ entries: ChangeLogEntry[] }>(
    `/admin/changelog${query ? `?${query}` : ""}`,
  );
  const tail = entries.slice(0, limit);

  if (wantsJson(options)) {
    printJson({ entries: tail });
    return;
  }
  printTable(tail, COLUMNS, { title: "Change log" });
}
