import type { ParsedArgs } from "./args";

export type Column<T> = { header: string; value: (row: T) => string };

export function wantsJson(args: ParsedArgs): boolean {
  return args.booleans.has("json");
}

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function printTable<T>(rows: T[], columns: Column<T>[]): void {
  if (rows.length === 0) {
    process.stdout.write("(none)\n");
    return;
  }
  const cells = rows.map((row) => columns.map((col) => col.value(row)));
  const widths = columns.map((col, i) =>
    Math.max(col.header.length, ...cells.map((row) => row[i]?.length ?? 0)),
  );
  const line = (values: string[]) =>
    values
      .map((value, i) => value.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();

  process.stdout.write(`${line(columns.map((col) => col.header))}\n`);
  for (const row of cells) {
    process.stdout.write(`${line(row)}\n`);
  }
}

/** Stable cell text for nullable values across both output modes. */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
