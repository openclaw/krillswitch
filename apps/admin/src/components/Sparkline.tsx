import type { ChangeLogEntry, EvalStatRow } from "../api";

export const DAY_MS = 86_400_000;

/** Bucket change-log entries into per-day counts ending today. `match`
 *  scopes the entries (per project, per flag); omit it for everything. */
export function dailyCounts(
  entries: ChangeLogEntry[],
  days: number,
  match?: (entry: ChangeLogEntry) => boolean,
): number[] {
  const counts: number[] = new Array(days).fill(0);
  const today = new Date().setHours(0, 0, 0, 0);
  for (const entry of entries) {
    if (match && !match(entry)) continue;
    const day = new Date(entry.createdAt).setHours(0, 0, 0, 0);
    const age = Math.floor((today - day) / DAY_MS);
    if (age >= 0 && age < days) {
      const index = days - 1 - age;
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  return counts;
}

/** Bucket eval-traffic rows into per-day request counts ending today. */
export function usageSeries(
  stats: EvalStatRow[],
  days: number,
  match?: (row: EvalStatRow) => boolean,
): number[] {
  const counts: number[] = new Array(days).fill(0);
  const today = Math.floor(Date.now() / DAY_MS);
  for (const row of stats) {
    if (match && !match(row)) continue;
    const age = today - row.day;
    if (age >= 0 && age < days) {
      const index = days - 1 - age;
      counts[index] = (counts[index] ?? 0) + row.count;
    }
  }
  return counts;
}

function stepPath(counts: number[], width: number, height: number): string {
  const max = Math.max(1, ...counts);
  const dx = width / counts.length;
  const y = (count: number) => height - 2 - (count / max) * (height - 6);
  return counts
    .map(
      (count, index) =>
        `${index === 0 ? `M0 ${y(count)}` : `V${y(count)}`} H${(index + 1) * dx}`,
    )
    .join(" ");
}

/** Carapace `oc-sparkline`: the consumer (this component) computes the
 *  stepped geometry; the package owns size, stroke, and tone. `size="lg"`
 *  is the full-width dateline band. */
export function Sparkline({
  counts,
  width = 640,
  height = 44,
  label,
  size,
  className = "",
}: {
  counts: number[];
  width?: number;
  height?: number;
  label: string;
  size?: "lg";
  className?: string;
}) {
  const max = Math.max(1, ...counts);
  const last = counts[counts.length - 1] ?? 0;
  const lastY = height - 2 - (last / max) * (height - 6);
  return (
    <svg
      className={`oc-sparkline ${className}`}
      data-size={size}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path className="oc-sparkline-line" d={stepPath(counts, width, height)} />
      <rect
        className="oc-sparkline-endpoint"
        x={width - Math.max(7, width / 90)}
        y={Math.min(lastY - 2, height - 4)}
        width={Math.max(7, width / 90)}
        height="4"
      />
    </svg>
  );
}
