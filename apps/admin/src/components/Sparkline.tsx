import type { ChangeLogEntry } from "../api";

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

/** Maintainer-report-style step chart. Inherits `currentColor` for the
 *  line; the last day gets an accent end marker. */
export function Sparkline({
  counts,
  width = 640,
  height = 44,
  label,
  className = "",
}: {
  counts: number[];
  width?: number;
  height?: number;
  label: string;
  className?: string;
}) {
  const max = Math.max(1, ...counts);
  const last = counts[counts.length - 1] ?? 0;
  const lastY = height - 2 - (last / max) * (height - 6);
  return (
    <svg
      className={`sparkline ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path
        d={stepPath(counts, width, height)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={width - Math.max(7, width / 90)}
        y={Math.min(lastY - 2, height - 4)}
        width={Math.max(7, width / 90)}
        height="4"
        fill="var(--accent)"
      />
    </svg>
  );
}
