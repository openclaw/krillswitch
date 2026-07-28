import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { EmptyState } from "../components/EmptyState";
import { KeysSection } from "../components/KeysSection";
import { BlockSkeleton, TableSkeleton } from "../components/Skeleton";
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
          <h1>{project.name}</h1>
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
            <th className="th-state">State</th>
          </tr>
        </thead>
        <tbody>
          {flags.data.flags.map((flag) => (
            <FlagRow
              key={flag.id}
              flag={flag}
              canEdit={canEdit}
              detailPath={detailPath(flag.key)}
            />
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function FlagRow({
  flag,
  canEdit,
  detailPath,
}: {
  flag: FlagListEntry;
  canEdit: boolean;
  detailPath: string;
}) {
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
        <code>{flag.key}</code>
      </td>
      <td>
        <span className="badge-kind">{flag.kind}</span>
      </td>
      <td className="td-state">
        {canEdit ? (
          <Link
            className="state-change-link row-control"
            to={detailPath}
            aria-label={`Change ${flag.key}`}
          >
            {stateWord}
            <ChevronRightIcon className="state-chevron" />
          </Link>
        ) : (
          stateWord
        )}
      </td>
    </tr>
  );
}
