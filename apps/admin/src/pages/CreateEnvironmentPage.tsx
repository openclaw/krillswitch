import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api } from "../api";

export function CreateEnvironmentPage() {
  const { projectKey = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");

  const projectPath = `/projects/${encodeURIComponent(projectKey)}`;

  const create = useMutation({
    mutationFn: () =>
      api.createEnvironment(projectKey, key.trim(), name.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keys", projectKey] });
      queryClient.invalidateQueries({ queryKey: ["project", projectKey] });
      navigate(projectPath);
    },
  });

  const errorMessage =
    create.error instanceof ApiError && create.error.status === 409
      ? "An environment with this key already exists."
      : create.isError
        ? "Creating the environment failed."
        : null;
  const canSubmit =
    key.trim() !== "" && name.trim() !== "" && !create.isPending;

  return (
    <section>
      <header className="oc-page-header">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to={projectPath}>{projectKey}</Link>
          </nav>
          <h1>New environment</h1>
        </div>
      </header>

      <form
        className="form-page"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) create.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="new-env-name">Name</label>
          <input
            id="new-env-name"
            className="oc-input"
            placeholder="Staging"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-env-key">Key</label>
          <input
            id="new-env-key"
            className="oc-input input-mono"
            placeholder="e.g. staging"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <p className="field-hint">
            Environments hold their own flag states and targeting. Creating one
            mints its public evaluation key.
          </p>
        </div>
        {errorMessage && (
          <p role="alert" className="save-error">
            {errorMessage}
          </p>
        )}
        <div className="form-actions">
          <button
            type="submit"
            className="oc-action oc-action-primary"
            disabled={!canSubmit}
          >
            Create environment
          </button>
          <Link className="oc-action oc-action-ghost btn-link" to={projectPath}>
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
