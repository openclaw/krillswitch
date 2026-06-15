import type { ParsedArgs } from "../args";
import type { KrillswitchClient } from "../client";
import { type Column, printJson, printTable, wantsJson } from "../output";

type Project = { id: string; key: string; name: string };

const COLUMNS: Column<Project>[] = [
  { header: "KEY", value: (p) => p.key },
  { header: "NAME", value: (p) => p.name },
];

export async function projectsList(
  client: KrillswitchClient,
  args: ParsedArgs,
): Promise<void> {
  const { projects } = await client.request<{ projects: Project[] }>(
    "/admin/projects",
  );
  if (wantsJson(args)) {
    printJson({ projects });
    return;
  }
  printTable(projects, COLUMNS);
}
