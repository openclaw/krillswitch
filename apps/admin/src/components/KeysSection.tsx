import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "../api";

/** Admin-only project panel: eval keys per environment + new environments. */
export function KeysSection({ projectKey }: { projectKey: string }) {
  const queryClient = useQueryClient();
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

  const [confirmingRotate, setConfirmingRotate] = useState<string | null>(null);

  if (keys.isPending) {
    return <p className="muted">Loading keys…</p>;
  }
  if (keys.isError) {
    return <p role="alert">Failed to load eval keys.</p>;
  }

  return (
    <section className="detail-section">
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
      <table className="data-table">
        <thead>
          <tr>
            <th>Environment</th>
            <th>Key</th>
            <th className="th-remove" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {keys.data.keys.map((entry) => (
            <tr key={entry.environmentId}>
              <td>{entry.environmentName}</td>
              <td>
                <code>{entry.evalKey}</code>
              </td>
              <td className="td-remove">
                {confirmingRotate === entry.environmentKey ? (
                  <span className="confirm-delete">
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={rotate.isPending}
                      onClick={() => {
                        rotate.mutate(entry.environmentKey);
                        setConfirmingRotate(null);
                      }}
                    >
                      Confirm rotate
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => setConfirmingRotate(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => setConfirmingRotate(entry.environmentKey)}
                  >
                    Rotate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewEnvironmentForm projectKey={projectKey} />
    </section>
  );
}

function NewEnvironmentForm({ projectKey }: { projectKey: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.createEnvironment(projectKey, key.trim(), name.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keys", projectKey] });
      queryClient.invalidateQueries({ queryKey: ["project", projectKey] });
      setOpen(false);
      setKey("");
      setName("");
    },
  });

  const errorMessage =
    create.error instanceof ApiError
      ? create.error.status === 409
        ? "An environment with this key already exists."
        : "Creating the environment failed."
      : create.isError
        ? "Creating the environment failed."
        : null;

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => setOpen(true)}
      >
        New environment
      </button>
    );
  }

  return (
    <div className="inline-create">
      <input
        className="input input-mono"
        aria-label="New environment key"
        placeholder="key (e.g. staging)"
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <input
        className="input"
        aria-label="New environment name"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        type="button"
        className="btn btn-primary"
        disabled={create.isPending || key.trim() === "" || name.trim() === ""}
        onClick={() => create.mutate()}
      >
        Create environment
      </button>
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
      {errorMessage && (
        <p role="alert" className="save-error">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
