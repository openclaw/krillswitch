import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { ApiError, api, type Me } from "../api";

export function ProjectsPage({ me }: { me: Me }) {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });

  return (
    <section>
      <header className="page-header">
        <h1>Projects</h1>
      </header>
      {projects.isPending && <p className="muted">Loading projects…</p>}
      {projects.isError && <p role="alert">Failed to load projects.</p>}
      {projects.isSuccess && projects.data.projects.length === 0 && (
        <p className="muted">No projects yet.</p>
      )}
      {projects.isSuccess && projects.data.projects.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
            </tr>
          </thead>
          <tbody>
            {projects.data.projects.map((project) => (
              <tr key={project.id}>
                <td>
                  <Link className="table-link" to={`/projects/${project.key}`}>
                    {project.name}
                  </Link>
                </td>
                <td>
                  <code>{project.key}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {me.role === "admin" && <NewProjectForm />}
    </section>
  );
}

function NewProjectForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => api.createProject(key.trim(), name.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      setKey("");
      setName("");
    },
  });

  const errorMessage =
    create.error instanceof ApiError && create.error.status === 409
      ? "A project with this key already exists."
      : create.isError
        ? "Creating the project failed."
        : null;

  if (!open) {
    return (
      <div className="below-table">
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => setOpen(true)}
        >
          New project
        </button>
      </div>
    );
  }

  return (
    <div className="inline-create below-table">
      <input
        className="input input-mono"
        aria-label="New project key"
        placeholder="key (e.g. clawhub)"
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <input
        className="input"
        aria-label="New project name"
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
        Create project
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
