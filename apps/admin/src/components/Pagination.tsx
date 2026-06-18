import { ChevronRightIcon } from "./brand";

const WINDOW = 7;

/** Visible page slots. Always returns the same number of slots for a given
 *  page count (WINDOW once there are more than WINDOW pages), so the control's
 *  width never changes as you move between pages. Ellipsis gaps render at the
 *  same width as a number, so two gaps and one gap take the same space. */
function pageWindow(current: number, count: number): (number | "gap")[] {
  if (count <= WINDOW) {
    return Array.from({ length: count }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, "gap", count];
  }
  if (current >= count - 3) {
    return [1, "gap", count - 4, count - 3, count - 2, count - 1, count];
  }
  return [1, "gap", current - 1, current, current + 1, "gap", count];
}

/** Numbered page control. Renders nothing for a single page. */
export function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="page-btn page-arrow"
        disabled={page === 1}
        aria-label="Previous page"
        onClick={() => onPage(page - 1)}
      >
        <ChevronRightIcon className="page-arrow-icon page-arrow-prev" />
      </button>
      {pageWindow(page, pageCount).map((entry, index) =>
        entry === "gap" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static ellipsis marker
          <span key={`gap-${index}`} className="page-gap" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            className={`page-btn ${entry === page ? "is-current" : ""}`}
            aria-current={entry === page ? "page" : undefined}
            onClick={() => onPage(entry)}
          >
            {entry}
          </button>
        ),
      )}
      <button
        type="button"
        className="page-btn page-arrow"
        disabled={page === pageCount}
        aria-label="Next page"
        onClick={() => onPage(page + 1)}
      >
        <ChevronRightIcon className="page-arrow-icon" />
      </button>
    </nav>
  );
}
