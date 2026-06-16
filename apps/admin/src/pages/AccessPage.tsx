import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AdminRole, ApiError, api, type Me } from "../api";
import { AccessTokensSection } from "../components/AccessTokensSection";
import { TableFrame } from "../components/TableFrame";

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "no access" },
  { value: "viewer", label: "viewer" },
  { value: "editor", label: "editor" },
  { value: "admin", label: "admin" },
];

function parseRole(value: string): AdminRole | null {
  return value === "admin" || value === "editor" || value === "viewer"
    ? value
    : null;
}

export function AccessPage({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: api.users });

  const setRole = useMutation({
    mutationFn: (input: { userId: string; role: AdminRole | null }) =>
      api.setUserRole(input.userId, input.role),
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      if (input.userId === me.user.id) {
        queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    },
  });

  const errorMessage =
    setRole.error instanceof ApiError
      ? (setRole.error.serverMessage ?? "Changing the role failed.")
      : setRole.isError
        ? "Changing the role failed."
        : null;

  return (
    <section>
      <header className="page-header">
        <h1>Access</h1>
      </header>
      <p className="muted section-hint">
        Roles apply service-wide. Users appear here after their first sign-in;
        granting by external identity arrives with the real auth provider.
      </p>
      {errorMessage && (
        <p role="alert" className="save-error">
          {errorMessage}
        </p>
      )}
      {users.isPending && <p className="muted">Loading users…</p>}
      {users.isError && <p role="alert">Failed to load users.</p>}
      {users.isSuccess && (
        <TableFrame className="table-frame-access">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th className="th-role">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.data.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    {user.name}
                    {user.id === me.user.id && (
                      <span className="muted"> (you)</span>
                    )}
                  </td>
                  <td>
                    <code>{user.email}</code>
                  </td>
                  <td className="td-role">
                    <select
                      className="input"
                      aria-label={`Role for ${user.name}`}
                      value={user.role ?? "none"}
                      disabled={setRole.isPending}
                      onChange={(event) =>
                        setRole.mutate({
                          userId: user.id,
                          role: parseRole(event.target.value),
                        })
                      }
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
      <AccessTokensSection />
    </section>
  );
}
