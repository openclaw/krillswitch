import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api, type EvalStatRow, type Me, type ProjectSummary } from "../api";
import krillBanner from "../assets/krill-banner.avif";
import {
  FolderIcon,
  LayersIcon,
  ListIcon,
  PlugIcon,
} from "../components/brand";
import { EmptyState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { TableSkeleton } from "../components/Skeleton";
import { DAY_MS, Sparkline, usageSeries } from "../components/Sparkline";
import { TableFrame } from "../components/TableFrame";

const PAGE_SIZE = 10;

// Usage chart: eval requests per day across every environment, drawn as a
// step line like the carapace.design/maintainer report datelines.
const USAGE_DAYS = 30;

function UsageChart({ stats }: { stats: EvalStatRow[] }) {
  const counts = usageSeries(stats, USAGE_DAYS);
  const totalRequests = counts.reduce((sum, count) => sum + count, 0);
  const startLabel = new Date(
    Date.now() - (USAGE_DAYS - 1) * DAY_MS,
  ).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <section className="dateline" aria-label="Eval traffic">
      <p className="dateline-label">Usage</p>
      <Sparkline
        counts={counts}
        size="lg"
        label={`${totalRequests} eval requests in the last ${USAGE_DAYS} days`}
      />
      <div className="dateline-meta">
        <span>{startLabel}</span>
        <span>
          {totalRequests.toLocaleString()} request
          {totalRequests === 1 ? "" : "s"} · last {USAGE_DAYS} days
        </span>
        <span>{endLabel}</span>
      </div>
    </section>
  );
}

/** Carapace oc-delta: last 7 days of requests vs the 7 before. Direction
 *  tints only the arrow — traffic volume is not a value judgment. */
function UsageDelta({ counts }: { counts: number[] }) {
  const recent = counts.slice(-7).reduce((sum, count) => sum + count, 0);
  const prior = counts.slice(-14, -7).reduce((sum, count) => sum + count, 0);
  if (prior === 0 && recent === 0) return null;
  const change =
    prior === 0 ? 100 : Math.round(((recent - prior) / prior) * 100);
  const direction = change >= 0 ? "up" : "down";
  return (
    <span className="oc-delta" data-direction={direction}>
      <span className="oc-delta-arrow" aria-hidden="true">
        {direction === "up" ? "▲" : "▼"}
      </span>
      {Math.abs(change)}% vs prior 7d
    </span>
  );
}

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
  // Per-day eval request counts feed the usage chart and row sparklines.
  const usage = useQuery({ queryKey: ["eval-stats"], queryFn: api.evalStats });

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
      <header className="page-hero">
        <div className="page-hero-backdrop" aria-hidden="true">
          <img src={krillBanner} alt="" />
        </div>
        <div className="page-hero-content">
          <p className="page-hero-kicker">KrillSwitch · Feature flags</p>
          <h1>Projects</h1>
          <p className="page-hero-sub">
            Flags, environments, targeting, and audit for every app. Changes
            reach clients within a second.
          </p>
        </div>
      </header>

      {usage.isSuccess && usage.data.stats.length > 0 && (
        <UsageChart stats={usage.data.stats} />
      )}

      {projects.isSuccess && total > 0 && (
        <div className="page-toolbar">
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

      {projects.isSuccess && total > 0 && (
        <div className="oc-summary-strip">
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
              <small>Flags</small>
            </span>
          </div>
          <div className="oc-summary-metric">
            <span className="oc-summary-metric-icon" aria-hidden="true">
              <LayersIcon />
            </span>
            <span className="oc-summary-metric-copy">
              <strong>{visibleEnvironmentCount}</strong>
              <small>Environments</small>
            </span>
          </div>
          <div className="oc-summary-metric">
            <span className="oc-summary-metric-icon" aria-hidden="true">
              <PlugIcon />
            </span>
            <span className="oc-summary-metric-copy">
              <strong>
                {usageSeries(usage.data?.stats ?? [], 30)
                  .reduce((sum, count) => sum + count, 0)
                  .toLocaleString()}
              </strong>
              <small>Requests · 30d</small>
              <UsageDelta counts={usageSeries(usage.data?.stats ?? [], 14)} />
            </span>
          </div>
        </div>
      )}

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
          <ProjectsTable
            projects={visible}
            query={query}
            usageStats={usage.data?.stats ?? []}
          />
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}
    </section>
  );
}

function ProjectsTable({
  projects,
  query,
  usageStats,
}: {
  projects: ProjectSummary[];
  query: string;
  usageStats: EvalStatRow[];
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
            <th className="th-activity">Usage</th>
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
                <span className="oc-badge oc-badge-neutral badge-soft">
                  {project.flagCount}
                </span>
              </td>
              <td className="td-activity">
                <Sparkline
                  counts={usageSeries(
                    usageStats,
                    14,
                    (row) => row.projectKey === project.key,
                  )}
                  width={90}
                  height={18}
                  className="cell-spark"
                  label={`${project.key} eval requests, last 14 days`}
                />
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
