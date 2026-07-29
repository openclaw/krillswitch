/** Deterministic per-position variation colors: the same variation reads as
 *  the same color in the variations table, rule serve selects, and the
 *  rollout split bar. Keyed by position, not value, so renames and value
 *  edits keep their color. */
const VARIATION_COLORS = [
  "#3b82f6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#06b6d4",
  "#ef4444",
  "#84cc16",
] as const;

export function variationColor(index: number): string {
  return VARIATION_COLORS[index % VARIATION_COLORS.length] as string;
}

export function VariationDot({ index }: { index: number }) {
  return (
    <span
      className="variation-dot"
      style={{ backgroundColor: variationColor(index) }}
      aria-hidden="true"
    />
  );
}
