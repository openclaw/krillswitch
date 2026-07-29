import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api, type ChangeLogEntry } from "../api";
import { actionLabel } from "../changeLogActions";
import { ListIcon } from "../components/brand";
import { Combobox, type ComboboxOption } from "../components/Combobox";
import { EmptyState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { TableSkeleton } from "../components/Skeleton";

const PAGE_SIZE = 15;

export function ChangeLogPage() {
  // Filters live in the URL so other pages (flag History) can deep-link here.
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get("project") ?? "";
  const flagFilter = searchParams.get("flag") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  // A filter change resets to the first page (page is set only when passed).
  function updateParams(next: {
    project?: string;
    flag?: string;
    page?: number;
  }) {
    const params = new URLSearchParams(searchParams);
    const write = (key: string, value: string) =>
      value ? params.set(key, value) : params.delete(key);
    if (next.project !== undefined) write("project", next.project);
    if (next.flag !== undefined) write("flag", next.flag);
    const nextPage = next.page ?? 1;
    write("page", nextPage > 1 ? String(nextPage) : "");
    setSearchParams(params, { replace: true });
  }
  function changeProjectFilter(value: string) {
    updateParams({ project: value });
  }
  function changeFlagFilter(value: string) {
    updateParams({ flag: value });
  }
  const setPage = (nextPage: number) => updateParams({ page: nextPage });

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
      {log.isPending && <TableSkeleton columns={4} rows={PAGE_SIZE} />}
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
          <div className="oc-log-stream changelog-stream">
            {entries.map((entry) => (
              <ChangeRow key={entry.id} entry={entry} />
            ))}
          </div>
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

// The level chip is the action verb; destructive actions read as warnings.
function logLevel(action: string): "warn" | "info" {
  return /delete|revoke|rotate/.test(action) ? "warn" : "info";
}

function actionVerb(action: string): string {
  return action.split(".").pop() ?? action;
}

function ChangeRow({ entry }: { entry: ChangeLogEntry }) {
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
      <time className="oc-log-time">{formatWhen(entry.createdAt)}</time>
      <span className="oc-log-level">{actionVerb(entry.action)}</span>
      <span className="oc-log-subsystem" title={entry.target}>
        {subsystem}
      </span>
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
