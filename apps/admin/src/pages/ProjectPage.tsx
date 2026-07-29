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
import { api, type FlagListEntry, type Me } from "../api";
import { ChevronRightIcon, LayersIcon, ListIcon } from "../components/brand";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { EnvBadge, isProductionEnv } from "../components/EnvBadge";
import { GuardrailDialog } from "../components/GuardrailDialog";
import { KeysSection } from "../components/KeysSection";
import { BlockSkeleton, TableSkeleton } from "../components/Skeleton";
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
          </div>
        </div>
        <div className="oc-page-header-actions">
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
        detailPath={(flagKey) =>
          `/projects/${projectKey}/${environmentKey}/flags/${flagKey}`
        }
      />
      {me.role === "admin" && <KeysSection projectKey={projectKey} />}
    </section>
  );
}

function FlagTable({
  projectKey,
  environmentKey,
  canEdit,
  detailPath,
}: {
  projectKey: string;
  environmentKey: string;
  canEdit: boolean;
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
  detailPath,
}: {
  flag: FlagListEntry;
  projectKey: string;
  environmentKey: string;
  canEdit: boolean;
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
