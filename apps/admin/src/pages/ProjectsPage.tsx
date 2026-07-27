import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api, type Me, type ProjectSummary } from "../api";
import { FolderIcon, LayersIcon, ListIcon } from "../components/brand";
import { EmptyState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { TableSkeleton } from "../components/Skeleton";
import { TableFrame } from "../components/TableFrame";

const PAGE_SIZE = 10;

function formatLastChange(epochMs: number | null): string {
  if (epochMs === null) return "No changes yet";
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ProjectsPage({ me }: { me: Me }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const projects = useQuery({
    queryKey: ["projects", page],
    queryFn: () =>
      api.projects({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const isAdmin = me.role === "admin";
  const rows = projects.data?.projects ?? [];
  const total = projects.data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const query = search.trim().toLowerCase();
  const visible = query
    ? rows.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.key.toLowerCase().includes(query),
      )
    : rows;
  const visibleFlagCount = visible.reduce(
    (sum, project) => sum + project.flagCount,
    0,
  );
  const visibleEnvironmentCount = visible.reduce(
    (sum, project) => sum + project.environmentCount,
    0,
  );

  return (
    <section>
      <header className="oc-page-header">
        <div className="oc-page-header-content">
          <div className="page-title-row">
            <h1>Projects</h1>
            {projects.isSuccess && total > 0 && (
              <span className="title-count">{total}</span>
            )}
          </div>
          {projects.isSuccess && total > 0 && (
            <div className="oc-summary-strip oc-page-header-summary">
              <div className="oc-summary-metric">
                <span className="oc-summary-metric-icon" aria-hidden="true">
                  <FolderIcon />
                </span>
                <span className="oc-summary-metric-copy">
                  <strong>{total}</strong>
                  <small>Projects</small>
                </span>
              </div>
              <div className="oc-summary-metric">
                <span className="oc-summary-metric-icon" aria-hidden="true">
                  <ListIcon />
                </span>
                <span className="oc-summary-metric-copy">
                  <strong>{visibleFlagCount}</strong>
                  <small>Flags shown</small>
                </span>
              </div>
              <div className="oc-summary-metric">
                <span className="oc-summary-metric-icon" aria-hidden="true">
                  <LayersIcon />
                </span>
                <span className="oc-summary-metric-copy">
                  <strong>{visibleEnvironmentCount}</strong>
                  <small>Envs shown</small>
                </span>
              </div>
            </div>
          )}
        </div>
        {projects.isSuccess && total > 0 && (
          <div className="oc-page-header-actions">
            <input
              className="oc-input projects-search"
              type="search"
              aria-label="Filter projects on this page"
              placeholder="Filter this page…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {isAdmin && (
              <Link
                className="oc-action oc-action-primary btn-link"
                to="/projects/new"
              >
                New project
              </Link>
            )}
          </div>
        )}
      </header>

      {projects.isPending && (
        <TableSkeleton
          columns={4}
          rows={PAGE_SIZE}
          frameClassName="oc-table-wrap-projects"
        />
      )}
      {projects.isError && <p role="alert">Failed to load projects.</p>}

      {projects.isSuccess &&
        total === 0 &&
        (isAdmin ? (
          <EmptyState
            icon={<FolderIcon className="empty-state-glyph" />}
            title="Create your first project"
            description="Projects group your flags, environments, and evaluation keys. Create one to start shipping features behind flags."
            action={
              <Link
                className="oc-action oc-action-primary btn-link"
                to="/projects/new"
              >
                New project
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<FolderIcon className="empty-state-glyph" />}
            title="No projects yet"
            description="An admin creates projects. Once one exists, the flags you can read will appear here."
          />
        ))}

      {projects.isSuccess && total > 0 && (
        <>
          <ProjectsTable projects={visible} query={query} />
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}
    </section>
  );
}

function ProjectsTable({
  projects,
  query,
}: {
  projects: ProjectSummary[];
  query: string;
}) {
  if (projects.length === 0) {
    return (
      <EmptyState
        title="No matching projects"
        description={`No project name or key matches “${query}” on this page.`}
      />
    );
  }

  return (
    <TableFrame className="oc-table-wrap-projects">
      <table className="oc-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Key</th>
            <th className="col-num">Flags</th>
            <th>Last change</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} className="row-link">
              <td>
                <Link
                  className="table-link row-stretch"
                  to={`/projects/${project.key}`}
                >
                  {project.name}
                </Link>
                {project.description && (
                  <span className="cell-sub">{project.description}</span>
                )}
              </td>
              <td>
                <code>{project.key}</code>
              </td>
              <td className="col-num">
                <span className="badge-soft">{project.flagCount}</span>
              </td>
              <td className="cell-muted">
                {formatLastChange(project.lastChangeAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
