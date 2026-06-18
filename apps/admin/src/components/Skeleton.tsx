import { TableFrame } from "./TableFrame";

/** Shimmer placeholder for a table while its data loads. Renders immediately
 *  so it reserves the table's space and the layout holds steady (transitions
 *  keep the previous rows via keepPreviousData, so this only shows on a cold
 *  first load). */
export function TableSkeleton({
  columns,
  rows = 5,
  frameClassName,
}: {
  columns: number;
  rows?: number;
  frameClassName?: string;
}) {
  return (
    <TableFrame className={frameClassName}>
      <table className="data-table skeleton-table" role="presentation">
        <tbody>
          {Array.from({ length: rows }).map((_, row) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder, never reordered
            <tr key={row}>
              {Array.from({ length: columns }).map((_, col) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder, never reordered
                <td key={col}>
                  <span
                    className="skeleton"
                    style={{ width: col === 0 ? "62%" : "40%" }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

/** Shimmer placeholder for a detail/form view. */
export function BlockSkeleton({ lines = 4 }: { lines?: number }) {
  const widths = ["40%", "85%", "70%", "78%", "55%", "82%"];
  return (
    <div className="skeleton-block" role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, line) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder, never reordered
          key={line}
          className="skeleton"
          style={{ width: widths[line % widths.length] }}
        />
      ))}
    </div>
  );
}
