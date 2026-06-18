import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { TableFrame } from "./TableFrame";

/** Admin-only project panel: eval keys per environment + new environments. */
export function KeysSection({ projectKey }: { projectKey: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // The environment currently being viewed, if any — used to leave the page
  // when that environment is the one deleted.
  const { environmentKey: currentEnvironmentKey } = useParams();
  const keys = useQuery({
    queryKey: ["keys", projectKey],
    queryFn: () => api.keys(projectKey),
  });

  const rotate = useMutation({
    mutationFn: (environmentKey: string) =>
      api.rotateKey(projectKey, environmentKey),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["keys", projectKey] }),
  });

  const remove = useMutation({
    mutationFn: (environmentKey: string) =>
      api.deleteEnvironment(projectKey, environmentKey),
    onSuccess: async (_, environmentKey) => {
      queryClient.invalidateQueries({ queryKey: ["keys", projectKey] });
      queryClient.invalidateQueries({
        queryKey: ["flags", projectKey, environmentKey],
      });
      const refreshedProject = queryClient.invalidateQueries({
        queryKey: ["project", projectKey],
      });
      if (environmentKey === currentEnvironmentKey) {
        // Wait for the refreshed environment list before leaving, so the
        // project page doesn't bounce back to the just-deleted environment.
        await refreshedProject;
        navigate(`/projects/${encodeURIComponent(projectKey)}`, {
          replace: true,
        });
      }
    },
  });

  if (keys.isPending) {
    return <p className="muted">Loading keys…</p>;
  }
  if (keys.isError) {
    return <p role="alert">Failed to load eval keys.</p>;
  }

  return (
    <section className="detail-section section-divider">
      <h2>Eval keys</h2>
      <p className="muted section-hint">
        Public flag-set identifiers, one per environment. Rotation invalidates
        the old key immediately.
      </p>
      {rotate.isError && (
        <p role="alert" className="save-error">
          Rotating the key failed.
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="save-error">
          Deleting the environment failed.
        </p>
      )}
      <TableFrame className="table-frame-keys">
        <table className="data-table">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Key</th>
              <th className="th-key-actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {keys.data.keys.map((entry) => (
              <tr key={entry.environmentId}>
                <td>{entry.environmentName}</td>
                <td>
                  <code>{entry.evalKey}</code>
                </td>
                <td className="td-key-actions">
                  <div className="key-actions">
                    <ConfirmDialog
                      title={`Rotate the ${entry.environmentName} key?`}
                      description="The current eval key stops working immediately. Any client still using it will fail until you ship the new key."
                      confirmLabel="Rotate key"
                      pending={rotate.isPending}
                      onConfirm={() => rotate.mutate(entry.environmentKey)}
                      trigger={
                        <button type="button" className="btn btn-quiet">
                          Rotate
                        </button>
                      }
                    />
                    <ConfirmDialog
                      title={`Delete the ${entry.environmentName} environment?`}
                      description="Its eval key and every flag's state and targeting in this environment are removed. Flags themselves and other environments are untouched. This can't be undone."
                      confirmLabel="Delete environment"
                      pending={remove.isPending}
                      onConfirm={() => remove.mutate(entry.environmentKey)}
                      trigger={
                        <button
                          type="button"
                          className="btn btn-quiet"
                          aria-label={`Delete ${entry.environmentName}`}
                        >
                          Delete
                        </button>
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <div className="below-table">
        <Link
          className="btn btn-quiet btn-link"
          to={`/projects/${encodeURIComponent(projectKey)}/environments/new`}
        >
          New environment
        </Link>
      </div>
    </section>
  );
}
