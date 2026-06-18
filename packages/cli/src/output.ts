import type { Writable } from "node:stream";
import type { OutputOptions } from "./options";

export type Column<T> = { header: string; value: (row: T) => string };
type TableOptions = { title?: string; output?: Writable };
type TextBlockOptions = { output?: Writable; marker?: "🦐" | "✕" };
type KeyValueRow = { field: string; value: string };
const DEFAULT_TABLE_WIDTH = 100;
const MAX_TABLE_WIDTH = 120;
const MIN_COLUMN_WIDTH = 4;
const TEXT_BLOCK_PADDING = 4;
const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
} as const;
type ColorTone = keyof typeof ANSI;

export function wantsJson(options: OutputOptions): boolean {
  return options.json;
}

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function printTable<T>(
  rows: T[],
  columns: Column<T>[],
  options: TableOptions = {},
): void {
  const title = options.title ?? "Results";
  const output = options.output ?? process.stdout;
  if (rows.length === 0) {
    printBorderedTable([["(none)"]], [6], 0, output, title);
    return;
  }
  const cells = rows.map((row) => columns.map((col) => col.value(row)));
  const headers = columns.map((col) => col.header.toLowerCase());
  const widths = tableWidths(headers, cells, output);
  printBorderedTable([headers, ...cells], widths, 1, output, title);
}

export function printKeyValues(
  title: string,
  rows: [field: string, value: string][],
  options: Omit<TableOptions, "title"> = {},
): void {
  const keyValueRows = rows.map(([field, value]) => ({ field, value }));
  printTable<KeyValueRow>(
    keyValueRows,
    [
      { header: "FIELD", value: (row) => row.field },
      { header: "VALUE", value: (row) => row.value },
    ],
    { ...options, title },
  );
}

export function printTextBlock(
  title: string,
  lines: string[],
  options: TextBlockOptions = {},
): void {
  const output = options.output ?? process.stdout;
  // A little krill heads up every success/info block; errors keep the ✕.
  const marker = options.marker ?? "🦐";
  const width = textBlockWidth(lines, output);
  const tone = marker === "✕" ? "red" : "cyan";
  output.write(
    `${color(output, marker, tone)}  ${color(output, title, tone)}\n`,
  );
  output.write(`${color(output, borderLine("╭", "─", "╮", [width]), tone)}\n`);
  for (const line of lines) {
    const wrapped = wrapLine(line, width);
    for (const wrappedLine of wrapped) {
      output.write(
        `${color(output, "│", tone)} ${styleTextLine(output, wrappedLine.padEnd(width), wrappedLine)} ${color(output, "│", tone)}\n`,
      );
    }
  }
  output.write(`${color(output, borderLine("╰", "─", "╯", [width]), tone)}\n`);
}

/** Stable cell text for nullable values across both output modes. */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function tableWidths(
  headers: string[],
  rows: string[][],
  output: Writable,
): number[] {
  const natural = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const widths = [...natural];
  const available = tableContentWidth(headers.length, output);
  const minimums = headers.map((header) =>
    Math.max(MIN_COLUMN_WIDTH, header.length),
  );

  while (
    sum(widths) > available &&
    widths.some((width, index) => width > (minimums[index] ?? MIN_COLUMN_WIDTH))
  ) {
    const widestIndex = widths.reduce((widest, width, index) => {
      const currentMinimum = minimums[index] ?? MIN_COLUMN_WIDTH;
      const widestMinimum = minimums[widest] ?? MIN_COLUMN_WIDTH;
      const widestWidth = widths[widest] ?? MIN_COLUMN_WIDTH;
      if (width <= currentMinimum) return widest;
      return width - currentMinimum > widestWidth - widestMinimum
        ? index
        : widest;
    }, 0);
    widths[widestIndex] = (widths[widestIndex] ?? MIN_COLUMN_WIDTH) - 1;
  }

  return widths;
}

function tableContentWidth(columnCount: number, output: Writable): number {
  const terminalWidth = terminalColumns(output);
  const width = Number.isFinite(terminalWidth)
    ? terminalWidth
    : DEFAULT_TABLE_WIDTH;
  return Math.max(
    columnCount * MIN_COLUMN_WIDTH,
    Math.min(width, MAX_TABLE_WIDTH) - (3 * columnCount + 1),
  );
}

function textBlockWidth(lines: string[], output: Writable): number {
  const longestLine = Math.max(1, ...lines.map((line) => line.length));
  const terminalWidth = terminalColumns(output);
  const available = Number.isFinite(terminalWidth)
    ? terminalWidth - TEXT_BLOCK_PADDING
    : DEFAULT_TABLE_WIDTH;
  return Math.max(
    MIN_COLUMN_WIDTH,
    Math.min(longestLine, Math.min(available, MAX_TABLE_WIDTH)),
  );
}

function terminalColumns(output: Writable): number {
  return Number(Reflect.get(output, "columns") ?? process.env.COLUMNS);
}

function fitCell(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return "…";
  return `${value.slice(0, width - 1)}…`;
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const words = line.trim().split(/\s+/);
  const wrapped: string[] = [];
  let current = indent;

  for (const word of words) {
    if (word.length > width) {
      if (current.trim().length > 0) {
        wrapped.push(current);
        current = indent;
      }
      for (let index = 0; index < word.length; index += width) {
        wrapped.push(word.slice(index, index + width));
      }
      continue;
    }
    const candidate =
      current.trim().length === 0 ? `${indent}${word}` : `${current} ${word}`;
    if (candidate.length > width && current.trim().length > 0) {
      wrapped.push(current);
      current = `${indent}${word}`;
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    wrapped.push(current);
  }
  return wrapped.length > 0 ? wrapped : [""];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function printBorderedTable(
  rows: string[][],
  widths: number[],
  headerRows = 0,
  output: Writable = process.stdout,
  title?: string,
): void {
  output.write(`${color(output, tableTopLine(widths, title), "cyan")}\n`);
  rows.forEach((row, index) => {
    output.write(`${tableRow(row, widths, output, index < headerRows)}\n`);
    if (index + 1 === headerRows) {
      output.write(
        `${color(output, borderLine("├", "┼", "┤", widths), "cyan")}\n`,
      );
    }
  });
  output.write(`${color(output, borderLine("╰", "┴", "╯", widths), "cyan")}\n`);
}

function tableRow(
  row: string[],
  widths: number[],
  output: Writable,
  isHeader: boolean,
): string {
  const cells = widths.map((width, index) => {
    const value = fitCell(row[index] ?? "", width);
    const padded = value.padEnd(width);
    return isHeader
      ? color(output, padded, "bold")
      : styleTableCell(output, padded, value);
  });
  const border = color(output, "│", "cyan");
  return `${border} ${cells.join(` ${border} `)} ${border}`;
}

function borderLine(
  left: string,
  join: string,
  right: string,
  widths: number[],
): string {
  return `${left}${widths.map((width) => "─".repeat(width + 2)).join(join)}${right}`;
}

function tableTopLine(widths: number[], title: string | undefined): string {
  if (!title) {
    return borderLine("╭", "┬", "╮", widths);
  }
  const fallback = borderLine("╭", "┬", "╮", widths);
  const innerWidth = fallback.length - 2;
  const maxTitleWidth = Math.max(1, innerWidth - 3);
  const label = `─ ${fitCell(title, maxTitleWidth)} `;
  return `╭${label}${"─".repeat(Math.max(0, innerWidth - label.length))}╮`;
}

function styleTextLine(
  output: Writable,
  padded: string,
  rawLine: string,
): string {
  if (rawLine.startsWith("Run:")) return color(output, padded, "green");
  if (rawLine.startsWith("Or:")) return color(output, padded, "cyan");
  if (rawLine.startsWith("Usage:")) return color(output, padded, "dim");
  if (rawLine.startsWith("Available ")) return color(output, padded, "cyan");
  return padded;
}

function styleTableCell(
  output: Writable,
  padded: string,
  value: string,
): string {
  if (value === "on") return color(output, padded, "green");
  if (value === "off") return color(output, padded, "yellow");
  if (value === "default") return color(output, padded, "green");
  return padded;
}

function color(output: Writable, value: string, tone: ColorTone): string {
  if (!useColor(output)) return value;
  return `${ANSI[tone]}${value}${ANSI.reset}`;
}

function useColor(output: Writable): boolean {
  if (process.env.FORCE_COLOR !== undefined) {
    return process.env.FORCE_COLOR !== "0";
  }
  return (
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== "dumb" &&
    Reflect.get(output, "isTTY") === true
  );
}
