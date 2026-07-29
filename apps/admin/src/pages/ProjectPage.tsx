import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Environment, EvalStatRow } from "../api";
import { api, type FlagListEntry, type Me } from "../api";
import { ChevronRightIcon, LayersIcon, ListIcon } from "../components/brand";
import { ChangeStream } from "../components/ChangeStream";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { EnvBadge, isProductionEnv } from "../components/EnvBadge";
import { GuardrailDialog } from "../components/GuardrailDialog";
import { KeysSection } from "../components/KeysSection";
import { BlockSkeleton, TableSkeleton } from "../components/Skeleton";
import { Sparkline, usageSeries } from "../components/Sparkline";
import { Switch } from "../components/Switch";
import { TableFrame } from "../components/TableFrame";

export function ProjectPage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const { projectKey = "", environmentKey } = useParams();

  const detail = useQuery({
    queryKey: ["project", projectKey],
    queryFn: () => api.projectDetail(projectKey),
    placeholderData: keepPreviousData,
  });
  // Recent-activity stream (audit) and per-flag usage sparklines (traffic).
  const activity = useQuery({
    queryKey: ["changelog-activity", projectKey],
    queryFn: () => api.changeLog({ projectKey }, { limit: 100 }),
  });
  const usage = useQuery({ queryKey: ["eval-stats"], queryFn: api.evalStats });

  if (detail.isPending) {
    return (
      <section>
        <header className="oc-page-header">
          <h1>Project</h1>
        </header>
        <BlockSkeleton lines={3} />
      </section>
    );
  }
  if (detail.isError) {
    return <p role="alert">Failed to load project.</p>;
  }

  const { project, environments } = detail.data;
  const firstEnvironment = environments[0];
  if (!environmentKey) {
    if (!firstEnvironment) {
      return (
        <section>
          <header className="oc-page-header">
            <div>
              <Link
                className="oc-page-header-kicker"
                to={`/projects/${projectKey}`}
              >
                {projectKey}
              </Link>
              <h1>{project.name}</h1>
            </div>
          </header>
          <EmptyState
            icon={<LayersIcon className="empty-state-glyph" />}
            title="Add an environment"
            description="Environments like development and production each hold their own evaluation key and flag states. Create one to start adding flags."
            action={
              me.role === "admin" ? (
                <Link
                  className="oc-action oc-action-primary btn-link"
                  to={`/projects/${encodeURIComponent(projectKey)}/environments/new`}
                >
                  New environment
                </Link>
              ) : undefined
            }
          />
        </section>
      );
    }
    return (
      <Navigate
        to={`/projects/${projectKey}/${firstEnvironment.key}`}
        replace
      />
    );
  }

  return (
    <section>
      <header className="oc-page-header">
        <div>
          <Link
            className="oc-page-header-kicker"
            to={`/projects/${projectKey}`}
          >
            {projectKey}
          </Link>
          <div className="page-title-row">
            <h1>{project.name}</h1>
            <EnvBadge
              envKey={environmentKey}
              name={
                environments.find((env) => env.key === environmentKey)?.name
              }
            />
            <SdkFreshness
              environment={environments.find(
                (env) => env.key === environmentKey,
              )}
            />
          </div>
        </div>
        <div className="oc-page-header-actions">
          <Link
            className="oc-action oc-action-ghost btn-link"
            to={`/projects/${projectKey}/segments`}
          >
            Segments
          </Link>
          <Select
            value={environmentKey}
            onValueChange={(env) =>
              navigate(`/projects/${projectKey}/${encodeURIComponent(env)}`)
            }
          >
            <SelectTrigger
              aria-label="Environment"
              className="w-auto min-w-[180px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {environments.map((environment) => (
                <SelectItem key={environment.id} value={environment.key}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(me.role === "editor" || me.role === "admin") && (
            <Link
              className="oc-action oc-action-primary btn-link"
              to={`/projects/${projectKey}/${environmentKey}/flags/new`}
            >
              New flag
            </Link>
          )}
        </div>
      </header>
      <FlagTable
        projectKey={projectKey}
        environmentKey={environmentKey}
        canEdit={me.role === "editor" || me.role === "admin"}
        usageStats={usage.data?.stats ?? []}
        detailPath={(flagKey) =>
          `/projects/${projectKey}/${environmentKey}/flags/${flagKey}`
        }
      />
      {activity.isSuccess && activity.data.entries.length > 0 && (
        <section className="detail-section">
          <h2>Recent activity</h2>
          <ChangeStream
            entries={activity.data.entries.slice(0, 8)}
            showSubsystem={false}
          />
          <Link
            className="history-more"
            to={`/changelog?project=${encodeURIComponent(projectKey)}`}
          >
            View all {activity.data.total} changes
          </Link>
        </section>
      )}
      {me.role === "admin" && <KeysSection projectKey={projectKey} />}
    </section>
  );
}

const SDK_ACTIVE_MS = 10 * 60 * 1000;
const SDK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** LD-style connection signal: has any SDK asked this environment for flags,
 *  and how recently. Counts come from /v1/eval bookkeeping. */
function SdkFreshness({ environment }: { environment?: Environment }) {
  if (!environment) return null;
  if (!environment.lastEvalAt) {
    return (
      <span
        className="oc-badge oc-badge-neutral"
        data-tip="No SDK has requested flags from this environment yet"
      >
        No requests yet
      </span>
    );
  }
  const age = Date.now() - new Date(environment.lastEvalAt).getTime();
  const tone =
    age < SDK_ACTIVE_MS
      ? "success"
      : age < SDK_STALE_MS
        ? "neutral"
        : "warning";
  const when =
    age < 60_000
      ? "just now"
      : age < 3_600_000
        ? `${Math.round(age / 60_000)}m ago`
        : age < 86_400_000
          ? `${Math.round(age / 3_600_000)}h ago`
          : `${Math.round(age / 86_400_000)}d ago`;
  return (
    <span
      className={`oc-badge oc-badge-${tone}`}
      data-tip={`${environment.evalCount.toLocaleString()} eval requests total`}
    >
      SDK {when}
    </span>
  );
}

function FlagTable({
  projectKey,
  environmentKey,
  canEdit,
  usageStats,
  detailPath,
}: {
  projectKey: string;
  environmentKey: string;
  canEdit: boolean;
  usageStats: EvalStatRow[];
  detailPath: (flagKey: string) => string;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const flags = useQuery({
    queryKey: ["flags", projectKey, environmentKey],
    queryFn: () => api.flags(projectKey, environmentKey),
    // Keep the previous environment's rows on screen while the new one loads,
    // so switching environments swaps content instead of flashing blank.
    placeholderData: keepPreviousData,
  });

  if (flags.isPending) {
    return <TableSkeleton columns={4} frameClassName="oc-table-wrap-flags" />;
  }
  if (flags.isError) {
    return <p role="alert">Failed to load flags.</p>;
  }
  const activeFlags = (flags.data?.flags ?? []).filter(
    (flag) => !flag.archived,
  );
  const archivedFlags = (flags.data?.flags ?? []).filter(
    (flag) => flag.archived,
  );
  if (flags.data.flags.length === 0) {
    return canEdit ? (
      <EmptyState
        icon={<ListIcon className="empty-state-glyph" />}
        title="Create your first flag"
        description={`Flags turn features on or off and target users without a deploy. Add the first one for ${environmentKey}.`}
        action={
          <Link
            className="oc-action oc-action-primary btn-link"
            to={`/projects/${projectKey}/${environmentKey}/flags/new`}
          >
            New flag
          </Link>
        }
      />
    ) : (
      <EmptyState
        icon={<ListIcon className="empty-state-glyph" />}
        title="No flags yet"
        description={`An editor adds flags. Once added, the flags for ${environmentKey} will appear here.`}
      />
    );
  }

  return (
    <TableFrame className="oc-table-wrap-flags">
      <table className="oc-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Key</th>
            <th>Kind</th>
            <th className="th-last-change">Last change</th>
            <th className="th-state">State</th>
          </tr>
        </thead>
        <tbody>
          {[...activeFlags, ...(showArchived ? archivedFlags : [])].map(
            (flag) => (
              <FlagRow
                key={flag.id}
                flag={flag}
                projectKey={projectKey}
                environmentKey={environmentKey}
                canEdit={canEdit}
                usageStats={usageStats}
                detailPath={detailPath(flag.key)}
              />
            ),
          )}
        </tbody>
      </table>
      {archivedFlags.length > 0 && (
        <button
          type="button"
          className="oc-action oc-action-ghost archived-toggle"
          aria-expanded={showArchived}
          onClick={() => setShowArchived((current) => !current)}
        >
          {showArchived
            ? "Hide archived"
            : `Show archived (${archivedFlags.length})`}
        </button>
      )}
    </TableFrame>
  );
}

function formatFlagChange(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function FlagRow({
  flag,
  projectKey,
  environmentKey,
  canEdit,
  usageStats,
  detailPath,
}: {
  flag: FlagListEntry;
  projectKey: string;
  environmentKey: string;
  canEdit: boolean;
  usageStats: EvalStatRow[];
  detailPath: string;
}) {
  const queryClient = useQueryClient();
  const isProduction = isProductionEnv(environmentKey);
  // Pending toggle direction while the production guardrail is open.
  const [guardNext, setGuardNext] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");

  const toggle = useMutation({
    mutationFn: (input: { next: boolean; comment?: string }) =>
      api.setFlagEnabled(
        projectKey,
        environmentKey,
        flag.key,
        input.next,
        input.comment,
      ),
    onSuccess: ({ flag: updated }) => {
      queryClient.setQueryData<{ flags: FlagListEntry[] }>(
        ["flags", projectKey, environmentKey],
        (current) =>
          current && {
            flags: current.flags.map((row) =>
              row.id === updated.id
                ? // Merge: the toggle response lacks list-only fields, and
                  // the toggle itself is this flag's newest change.
                  {
                    ...row,
                    ...updated,
                    lastChangedAt: new Date().toISOString(),
                  }
                : row,
            ),
          },
      );
      // The detail page seeds its draft from its own query; keep it fresh.
      queryClient.invalidateQueries({
        queryKey: ["flag", projectKey, environmentKey, flag.key],
      });
      queryClient.invalidateQueries({
        queryKey: ["flag-history", projectKey, flag.key],
      });
      setGuardNext(null);
      setComment("");
    },
  });

  function onToggle(next: boolean) {
    if (isProduction) {
      setGuardNext(next);
      return;
    }
    toggle.mutate({ next });
  }

  const stateWord = (
    <span className={`state-word ${flag.enabled ? "is-on" : ""}`}>
      {flag.enabled ? "On" : "Off"}
    </span>
  );
  return (
    <tr className="row-link">
      <td>
        <Link className="table-link flag-name row-stretch" to={detailPath}>
          {flag.name}
        </Link>
        {flag.description && (
          <div className="flag-description muted">{flag.description}</div>
        )}
      </td>
      <td>
        <span className="key-cell row-control">
          <code>{flag.key}</code>
          <CopyButton value={flag.key} label={`${flag.key} flag key`} />
        </span>
      </td>
      <td>
        <span className="badge-kind">{flag.kind}</span>
      </td>
      <td className="td-last-change muted">
        <Sparkline
          // Every eval request serves the whole flag set, so a flag's
          // serve count is its environment's request count.
          counts={usageSeries(
            usageStats,
            14,
            (row) =>
              row.projectKey === projectKey &&
              row.environmentKey === environmentKey,
          )}
          width={90}
          height={16}
          className="cell-spark"
          label={`Requests serving ${flag.key}, last 14 days`}
        />
        {formatFlagChange(flag.lastChangedAt)}
      </td>
      <td className="td-state">
        {flag.archived ? (
          <span className="oc-badge oc-badge-neutral">Archived</span>
        ) : canEdit ? (
          <span
            className="row-state row-control"
            data-tip={
              flag.offVariation ? `Off serves ${flag.offVariation}` : undefined
            }
          >
            <Switch
              checked={flag.enabled}
              disabled={toggle.isPending}
              ariaLabel={`${flag.key} enabled in ${environmentKey}`}
              onChange={onToggle}
            />
            <Link
              className="state-change-link"
              to={detailPath}
              aria-label={`Open ${flag.key}`}
            >
              <ChevronRightIcon className="state-chevron" />
            </Link>
          </span>
        ) : (
          stateWord
        )}
        {toggle.isError && (
          <span className="toggle-error" role="alert">
            Save failed — try again
          </span>
        )}
        <GuardrailDialog
          open={guardNext !== null}
          onOpenChange={(open) => {
            if (!open) {
              setGuardNext(null);
              setComment("");
            }
          }}
          environmentKey={environmentKey}
          title={`Turn ${guardNext ? "on" : "off"} “${flag.name}” in production?`}
          description={
            guardNext
              ? "Real traffic starts receiving this flag's enabled variations within a second."
              : "Real traffic falls back to the off variation within a second."
          }
          confirmLabel={guardNext ? "Turn on" : "Turn off"}
          comment={comment}
          onCommentChange={setComment}
          onConfirm={() =>
            guardNext !== null &&
            toggle.mutate({ next: guardNext, comment: comment.trim() })
          }
          pending={toggle.isPending}
        />
      </td>
    </tr>
  );
}
