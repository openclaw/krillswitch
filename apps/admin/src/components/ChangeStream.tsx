import { Link } from "react-router";
import type { ChangeLogEntry } from "../api";
import { actionLabel } from "../changeLogActions";

export function formatLogTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The level chip is the action verb; destructive actions read as warnings.
function logLevel(action: string): "warn" | "info" {
  return /delete|revoke|rotate/.test(action) ? "warn" : "info";
}

function actionVerb(action: string): string {
  return action.split(".").pop() ?? action;
}

/** Carapace log stream over change-log entries. The global change log shows
 *  the project/flag subsystem column; project- and flag-scoped viewers drop
 *  it (the scope is the page). Rows link to the full entry. */
export function ChangeStream({
  entries,
  showSubsystem = true,
}: {
  entries: ChangeLogEntry[];
  showSubsystem?: boolean;
}) {
  return (
    <div
      className={`oc-log-stream changelog-stream ${
        showSubsystem ? "" : "changelog-stream-scoped"
      }`}
    >
      {entries.map((entry) => (
        <ChangeRow key={entry.id} entry={entry} showSubsystem={showSubsystem} />
      ))}
    </div>
  );
}

function ChangeRow({
  entry,
  showSubsystem,
}: {
  entry: ChangeLogEntry;
  showSubsystem: boolean;
}) {
  const subsystem =
    entry.projectKey && entry.flagKey
      ? `${entry.projectKey}/${entry.flagKey}`
      : (entry.projectKey ?? entry.target);
  return (
    <Link
      className="oc-log-row"
      data-level={logLevel(entry.action)}
      to={`/changelog/${encodeURIComponent(entry.id)}`}
      aria-label={`View details: ${actionLabel(entry.action)} on ${entry.target}`}
    >
      <time className="oc-log-time">{formatLogTime(entry.createdAt)}</time>
      <span className="oc-log-level">{actionVerb(entry.action)}</span>
      {showSubsystem && (
        <span className="oc-log-subsystem" title={entry.target}>
          {subsystem}
        </span>
      )}
      <span className="oc-log-message">
        {actionLabel(entry.action)} — {entry.actorName}
        {entry.before !== null && (
          <code className="change-before">{JSON.stringify(entry.before)}</code>
        )}
        {entry.after !== null && (
          <code className="change-after">{JSON.stringify(entry.after)}</code>
        )}
        {entry.comment && (
          <span className="change-comment">“{entry.comment}”</span>
        )}
      </span>
    </Link>
  );
}
