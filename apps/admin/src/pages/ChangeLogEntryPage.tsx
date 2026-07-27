import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { actionLabel } from "../changeLogActions";
import { BlockSkeleton } from "../components/Skeleton";

function formatWhen(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function JsonBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: unknown;
  tone: "before" | "after";
}) {
  return (
    <div className="change-detail-block">
      <span className="field-label">{label}</span>
      <pre className={`change-detail-json change-detail-json-${tone}`}>
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </div>
  );
}

export function ChangeLogEntryPage() {
  const { id = "" } = useParams();
  const entryQuery = useQuery({
    queryKey: ["changelog-entry", id],
    queryFn: () => api.changeLogEntry(id),
  });

  const entry = entryQuery.data?.entry;
  const hasBefore = entry?.before !== null && entry?.before !== undefined;
  const hasAfter = entry?.after !== null && entry?.after !== undefined;

  return (
    <section>
      <header className="page-header">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/changelog">Change log</Link>
          </nav>
          <h1>{entry ? actionLabel(entry.action) : "Change"}</h1>
        </div>
      </header>

      {entryQuery.isPending && <BlockSkeleton lines={4} />}
      {entryQuery.isError && <p role="alert">That entry no longer exists.</p>}
      {entry && (
        <div className="form-page">
          <div className="field">
            <span className="field-label">When</span>
            <span className="field-value">{formatWhen(entry.createdAt)}</span>
          </div>
          <div className="field">
            <span className="field-label">Actor</span>
            <span className="field-value">{entry.actorName}</span>
          </div>
          {entry.projectKey && (
            <div className="field">
              <span className="field-label">Project</span>
              <span className="field-value">
                <code>{entry.projectKey}</code>
              </span>
            </div>
          )}
          {entry.flagKey && (
            <div className="field">
              <span className="field-label">Flag</span>
              <span className="field-value">
                <code>{entry.flagKey}</code>
              </span>
            </div>
          )}
          <div className="field">
            <span className="field-label">Target</span>
            <span className="field-value">
              <code className="change-detail-target">{entry.target}</code>
            </span>
          </div>
          {hasBefore && (
            <JsonBlock label="Before" value={entry.before} tone="before" />
          )}
          {hasAfter && (
            <JsonBlock label="After" value={entry.after} tone="after" />
          )}
          <div className="form-actions">
            <Link className="oc-action oc-action-ghost btn-link" to="/changelog">
              Back to change log
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
