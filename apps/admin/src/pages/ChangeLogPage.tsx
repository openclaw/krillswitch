import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api, type ChangeLogEntry } from "../api";
import { actionLabel } from "../changeLogActions";
import { ListIcon } from "../components/brand";
import { Combobox, type ComboboxOption } from "../components/Combobox";
import { EmptyState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { TableSkeleton } from "../components/Skeleton";
import { TableFrame } from "../components/TableFrame";

const PAGE_SIZE = 15;

export function ChangeLogPage() {
  const [flagFilter, setFlagFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [page, setPage] = useState(1);

  // A filter change resets to the first page.
  function changeProjectFilter(value: string) {
    setProjectFilter(value);
    setPage(1);
  }
  function changeFlagFilter(value: string) {
    setFlagFilter(value);
    setPage(1);
  }

  // Distinct key from the paginated Projects list (different cache shape).
  // First page of projects is plenty for the filter combobox.
  const projects = useQuery({
    queryKey: ["project-options"],
    queryFn: () => api.projects({ limit: 100 }),
  });
  const projectList = projects.data?.projects ?? [];

  // Flag suggestions come from the project in scope: the typed/selected project
  // if it matches a real one, otherwise the only project when there's just one.
  const matchedProject = projectList.find(
    (p) => p.key === projectFilter.trim(),
  );
  const scopedProjectKey =
    matchedProject?.key ??
    (projectList.length === 1 ? projectList[0]?.key : undefined);
  const flagKeys = useQuery({
    queryKey: ["project-flag-keys", scopedProjectKey],
    queryFn: () => api.projectFlagKeys(scopedProjectKey ?? ""),
    enabled: scopedProjectKey !== undefined,
  });

  const projectOptions: ComboboxOption[] = projectList.map((project) => ({
    value: project.key,
    label: project.key,
    hint: project.name,
  }));
  const flagOptions: ComboboxOption[] = (flagKeys.data?.flags ?? []).map(
    (flag) => ({ value: flag.key, label: flag.key, hint: flag.name }),
  );

  const hasFilters = projectFilter.trim() !== "" || flagFilter.trim() !== "";

  const log = useQuery({
    queryKey: ["changelog", flagFilter.trim(), projectFilter.trim(), page],
    queryFn: () =>
      api.changeLog(
        {
          flagKey: flagFilter.trim() || undefined,
          projectKey: projectFilter.trim() || undefined,
        },
        { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
      ),
    // Keep the current rows visible while a page or filter change refetches.
    placeholderData: keepPreviousData,
  });

  const entries = log.data?.entries ?? [];
  const total = log.data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <section>
      <header className="oc-page-header">
        <h1>Change log</h1>
        <div className="changelog-filters">
          <Combobox
            ariaLabel="Filter by project"
            placeholder="All projects"
            value={projectFilter}
            onChange={changeProjectFilter}
            options={projectOptions}
            emptyLabel="No projects"
          />
          <Combobox
            ariaLabel="Filter by flag"
            placeholder="All flags"
            value={flagFilter}
            onChange={changeFlagFilter}
            options={flagOptions}
            emptyLabel="No flags"
          />
        </div>
      </header>
      {log.isPending && (
        <TableSkeleton
          columns={5}
          rows={PAGE_SIZE}
          frameClassName="table-frame-changelog"
        />
      )}
      {log.isError && <p role="alert">Failed to load the change log.</p>}
      {log.isSuccess &&
        entries.length === 0 &&
        (hasFilters ? (
          <EmptyState
            title="No matching changes"
            description="No entries match these filters. Try a different project or flag."
            action={
              <button
                type="button"
                className="oc-action oc-action-secondary"
                onClick={() => {
                  changeProjectFilter("");
                  changeFlagFilter("");
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<ListIcon className="empty-state-glyph" />}
            title="No changes yet"
            description="Every flag toggle, rollout change, and role grant is recorded here, with who changed what and when."
          />
        ))}
      {log.isSuccess && entries.length > 0 && (
        <>
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
                {entries.map((entry) => (
                  <ChangeRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </TableFrame>
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </>
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
    <tr className="row-link">
      <td className="td-when muted">
        <Link
          className="row-link-plain row-stretch"
          to={`/changelog/${encodeURIComponent(entry.id)}`}
          aria-label={`View details: ${actionLabel(entry.action)} on ${entry.target}`}
        >
          {formatWhen(entry.createdAt)}
        </Link>
      </td>
      <td>{entry.actorName}</td>
      <td className="td-action">{actionLabel(entry.action)}</td>
      <td>
        <code title={entry.target}>{entry.target}</code>
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
