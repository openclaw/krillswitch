import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function ProjectsPage() {
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
                <td>{project.name}</td>
                <td>
                  <code>{project.key}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
