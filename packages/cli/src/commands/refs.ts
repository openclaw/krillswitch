import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { KrillswitchClient } from "../client";
import { CliUsageError } from "../errors";
import type { ProjectEnvOptions } from "../options";
import { printJson, printTextBlock, wantsJson } from "../output";

/** `krillswitch refs`: scan a source tree for the project's flag keys and
 *  report unreferenced flags — the cleanup candidates. A flag key is a
 *  plain string in code, so substring search is the honest tool; misses
 *  only dynamically-built keys, which no static scan can find. */

type FlagRow = {
  key: string;
  archived?: boolean;
  permanent?: boolean;
};

export type FlagReference = { file: string; line: number };

export type RefsReport = {
  scannedFiles: number;
  flags: {
    key: string;
    permanent: boolean;
    archived: boolean;
    references: FlagReference[];
  }[];
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  ".wrangler",
]);

const MAX_FILE_BYTES = 1_000_000;

function isProbablyBinary(content: Buffer): boolean {
  return content.subarray(0, 8_192).includes(0);
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        yield* walkFiles(join(root, entry.name));
      }
      continue;
    }
    if (entry.isFile()) {
      yield join(root, entry.name);
    }
  }
}

export async function scanFlagRefs(
  root: string,
  keys: string[],
): Promise<{ scannedFiles: number; refs: Map<string, FlagReference[]> }> {
  const refs = new Map<string, FlagReference[]>(keys.map((key) => [key, []]));
  let scannedFiles = 0;
  for await (const file of walkFiles(root)) {
    const info = await stat(file);
    if (info.size > MAX_FILE_BYTES) {
      continue;
    }
    const content = await readFile(file);
    if (isProbablyBinary(content)) {
      continue;
    }
    scannedFiles += 1;
    const text = content.toString("utf8");
    if (!keys.some((key) => text.includes(key))) {
      continue;
    }
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
      for (const key of keys) {
        if (line.includes(key)) {
          refs.get(key)?.push({
            file: relative(root, file),
            line: index + 1,
          });
        }
      }
    }
  }
  return { scannedFiles, refs };
}

function flagsBase(options: ProjectEnvOptions): string {
  return `/admin/projects/${encodeURIComponent(options.project)}/environments/${encodeURIComponent(options.env)}/flags`;
}

export async function flagsRefs(
  client: KrillswitchClient,
  options: ProjectEnvOptions,
  dir: string,
): Promise<void> {
  const rootStat = await stat(dir).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new CliUsageError(`not a directory: ${dir}`);
  }
  const { flags } = await client.request<{ flags: FlagRow[] }>(
    flagsBase(options),
  );
  if (flags.length === 0) {
    throw new CliUsageError("the environment has no flags to look for");
  }
  const { scannedFiles, refs } = await scanFlagRefs(
    dir,
    flags.map((flag) => flag.key),
  );
  const report: RefsReport = {
    scannedFiles,
    flags: flags.map((flag) => ({
      key: flag.key,
      permanent: flag.permanent ?? false,
      archived: flag.archived ?? false,
      references: refs.get(flag.key) ?? [],
    })),
  };
  if (wantsJson(options)) {
    printJson(report);
    return;
  }
  const lines: string[] = [];
  for (const flag of report.flags) {
    const count = flag.references.length;
    const marks = [
      flag.permanent ? "permanent" : null,
      flag.archived ? "archived" : null,
    ].filter((mark): mark is string => mark !== null);
    const suffix = marks.length > 0 ? ` (${marks.join(", ")})` : "";
    if (count === 0) {
      const advice =
        flag.permanent || flag.archived
          ? ""
          : " — cleanup candidate: archive it or delete the flag";
      lines.push(`✕ ${flag.key}${suffix} — no references${advice}`);
      continue;
    }
    const files = new Set(flag.references.map((reference) => reference.file));
    lines.push(
      `✓ ${flag.key}${suffix} — ${count} reference${count === 1 ? "" : "s"} in ${files.size} file${files.size === 1 ? "" : "s"}`,
    );
  }
  printTextBlock(`Flag references (${scannedFiles} files scanned)`, lines);
}
