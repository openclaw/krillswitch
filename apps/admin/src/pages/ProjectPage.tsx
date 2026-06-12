import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, useParams } from "react-router";
import { api, type FlagListEntry, type Me } from "../api";

export function ProjectPage({ me }: { me: Me }) {
  const { projectKey = "", environmentKey } = useParams();

  const detail = useQuery({
    queryKey: ["project", projectKey],
    queryFn: () => api.projectDetail(projectKey),
  });

  if (detail.isPending) {
    return <p className="muted">Loading project…</p>;
  }
  if (detail.isError) {
    return <p role="alert">Failed to load project.</p>;
  }

  const { project, environments } = detail.data;
  const firstEnvironment = environments[0];
  if (!environmentKey) {
    if (!firstEnvironment) {
      return <p className="muted">This project has no environments.</p>;
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
      <header className="page-header">
        <h1>{project.name}</h1>
        <nav className="env-switcher" aria-label="Environment">
          {environments.map((environment) => (
            <NavLink
              key={environment.id}
              to={`/projects/${projectKey}/${environment.key}`}
              className="env-tab"
            >
              {environment.name}
            </NavLink>
          ))}
        </nav>
      </header>
      <FlagTable
        projectKey={projectKey}
        environmentKey={environmentKey}
        canEdit={me.role === "editor" || me.role === "admin"}
      />
    </section>
  );
}

function FlagTable({
  projectKey,
  environmentKey,
  canEdit,
}: {
  projectKey: string;
  environmentKey: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const flags = useQuery({
    queryKey: ["flags", projectKey, environmentKey],
    queryFn: () => api.flags(projectKey, environmentKey),
  });

  const toggle = useMutation({
    mutationFn: (input: { flagKey: string; enabled: boolean }) =>
      api.setFlagEnabled(
        projectKey,
        environmentKey,
        input.flagKey,
        input.enabled,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["flags", projectKey, environmentKey],
      }),
  });

  if (flags.isPending) {
    return <p className="muted">Loading flags…</p>;
  }
  if (flags.isError) {
    return <p role="alert">Failed to load flags.</p>;
  }
  if (flags.data.flags.length === 0) {
    return <p className="muted">No flags in this environment.</p>;
  }

  return (
    <>
      {toggle.isError && (
        <p role="alert">Toggling the flag failed. Refresh and retry.</p>
      )}
      <table className="data-table">
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
              pending={
                toggle.isPending && toggle.variables?.flagKey === flag.key
              }
              onToggle={(enabled) =>
                toggle.mutate({ flagKey: flag.key, enabled })
              }
            />
          ))}
        </tbody>
      </table>
    </>
  );
}

function FlagRow({
  flag,
  canEdit,
  pending,
  onToggle,
}: {
  flag: FlagListEntry;
  canEdit: boolean;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <tr>
      <td>
        <div className="flag-name">{flag.name}</div>
        {flag.description && (
          <div className="flag-description muted">{flag.description}</div>
        )}
      </td>
      <td>
        <code>{flag.key}</code>
      </td>
      <td className="muted">{flag.kind}</td>
      <td className="td-state">
        {canEdit ? (
          <button
            type="button"
            role="switch"
            aria-checked={flag.enabled}
            aria-label={`Toggle ${flag.key}`}
            className={`flag-toggle ${flag.enabled ? "is-on" : ""}`}
            disabled={pending}
            onClick={() => onToggle(!flag.enabled)}
          >
            <span className="flag-toggle-track" />
            {flag.enabled ? "On" : "Off"}
          </button>
        ) : (
          <span className={`state-word ${flag.enabled ? "is-on" : ""}`}>
            {flag.enabled ? "On" : "Off"}
          </span>
        )}
      </td>
    </tr>
  );
}
