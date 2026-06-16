import type { KrillswitchClient } from "../client";
import type { CommonOptions } from "../options";
import { type Column, printJson, printTable, wantsJson } from "../output";

type Project = { id: string; key: string; name: string };

const COLUMNS: Column<Project>[] = [
  { header: "KEY", value: (p) => p.key },
  { header: "NAME", value: (p) => p.name },
];

export async function projectsList(
  client: KrillswitchClient,
  options: CommonOptions,
): Promise<void> {
  const { projects } = await client.request<{ projects: Project[] }>(
    "/admin/projects",
  );
  if (wantsJson(options)) {
    printJson({ projects });
    return;
  }
  printTable(projects, COLUMNS, { title: "Projects" });
}
