import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ChangeLogEntry } from "../api";
import { TableFrame } from "../components/TableFrame";

export function ChangeLogPage() {
  const [flagFilter, setFlagFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const entries = useQuery({
    queryKey: ["changelog", flagFilter, projectFilter],
    queryFn: () =>
      api.changeLog({
        flagKey: flagFilter.trim() || undefined,
        projectKey: projectFilter.trim() || undefined,
      }),
  });

  return (
    <section>
      <header className="page-header">
        <h1>Change log</h1>
        <div className="header-actions">
          <input
            className="input input-mono"
            aria-label="Filter by project key"
            placeholder="project key"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          />
          <input
            className="input input-mono"
            aria-label="Filter by flag key"
            placeholder="flag key"
            value={flagFilter}
            onChange={(event) => setFlagFilter(event.target.value)}
          />
        </div>
      </header>
      {entries.isPending && <p className="muted">Loading change log…</p>}
      {entries.isError && <p role="alert">Failed to load the change log.</p>}
      {entries.isSuccess && entries.data.entries.length === 0 && (
        <p className="muted">No changes match.</p>
      )}
      {entries.isSuccess && entries.data.entries.length > 0 && (
        <TableFrame className="table-frame-changelog">
          <table className="data-table changelog-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {entries.data.entries.map((entry) => (
                <ChangeRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </section>
  );
}

function formatWhen(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ChangeRow({ entry }: { entry: ChangeLogEntry }) {
  return (
    <tr>
      <td className="td-when muted">{formatWhen(entry.createdAt)}</td>
      <td>{entry.actorName}</td>
      <td>
        <code>{entry.action}</code>
      </td>
      <td>
        <code>{entry.target}</code>
      </td>
      <td className="td-change">
        {entry.before !== null && (
          <code className="change-before">{JSON.stringify(entry.before)}</code>
        )}
        {entry.before !== null && entry.after !== null && (
          <span className="muted change-sep">to</span>
        )}
        {entry.after !== null && (
          <code className="change-after">{JSON.stringify(entry.after)}</code>
        )}
      </td>
    </tr>
  );
}
