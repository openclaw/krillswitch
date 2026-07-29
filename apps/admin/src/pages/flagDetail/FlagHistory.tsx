import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../../api";
import { ChangeStream } from "../../components/ChangeStream";
import { BlockSkeleton } from "../../components/Skeleton";

const HISTORY_LIMIT = 8;

/** Recent audit entries for this flag as a scoped log stream; the full
 *  change log, pre-filtered to this flag, is one click away. */
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
        <ChangeStream entries={entries} showSubsystem={false} />
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
