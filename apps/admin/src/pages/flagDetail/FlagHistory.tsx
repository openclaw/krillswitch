import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../../api";
import { actionLabel } from "../../changeLogActions";
import { BlockSkeleton } from "../../components/Skeleton";

const HISTORY_LIMIT = 5;

function formatWhen(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Recent audit entries for this flag, shown where the changes are made;
 *  the full change log, pre-filtered to this flag, is one click away. */
export function FlagHistory({
  projectKey,
  flagKey,
}: {
  projectKey: string;
  flagKey: string;
}) {
  const history = useQuery({
    queryKey: ["flag-history", projectKey, flagKey],
    queryFn: () =>
      api.changeLog({ projectKey, flagKey }, { limit: HISTORY_LIMIT }),
  });

  const entries = history.data?.entries ?? [];
  const total = history.data?.total ?? 0;

  return (
    <section className="detail-section">
      <h2>History</h2>
      {history.isPending && <BlockSkeleton lines={3} />}
      {history.isError && <p role="alert">Failed to load history.</p>}
      {history.isSuccess && entries.length === 0 && (
        <p className="muted">No recorded changes yet.</p>
      )}
      {entries.length > 0 && (
        <ol className="history-list">
          {entries.map((entry) => (
            <li key={entry.id} className="history-item">
              <Link
                className="history-line"
                to={`/changelog/${encodeURIComponent(entry.id)}`}
              >
                <span className="history-action">
                  {actionLabel(entry.action)}
                </span>
                <span className="history-actor muted">{entry.actorName}</span>
                <time className="history-when muted">
                  {formatWhen(entry.createdAt)}
                </time>
              </Link>
              {entry.comment && (
                <p className="history-comment">“{entry.comment}”</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {total > HISTORY_LIMIT && (
        <Link
          className="history-more"
          to={`/changelog?project=${encodeURIComponent(projectKey)}&flag=${encodeURIComponent(flagKey)}`}
        >
          View all {total} changes
        </Link>
      )}
    </section>
  );
}
