import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, api } from "../api";

export function CreateProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => api.createProject(key.trim(), name.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${encodeURIComponent(key.trim())}`);
    },
  });

  const errorMessage =
    create.error instanceof ApiError && create.error.status === 409
      ? "A project with this key already exists."
      : create.isError
        ? "Creating the project failed."
        : null;
  const canSubmit =
    key.trim() !== "" && name.trim() !== "" && !create.isPending;

  return (
    <section>
      <header className="oc-page-header">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Projects</Link>
          </nav>
          <h1>New project</h1>
        </div>
      </header>

      <form
        className="form-page"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) create.mutate();
        }}
      >
        <div className="oc-field">
          <label htmlFor="new-project-name">Name</label>
          <input
            id="new-project-name"
            className="oc-input"
            placeholder="ClawHub"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="oc-field">
          <label htmlFor="new-project-key">Key</label>
          <input
            id="new-project-key"
            className="oc-input input-mono"
            placeholder="e.g. clawhub"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <p className="oc-field-message">
            A short, lowercase identifier used in URLs, the API, and the CLI.
            It's permanent; the display name can change later.
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
            Create project
          </button>
          <Link className="oc-action oc-action-ghost btn-link" to="/">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
