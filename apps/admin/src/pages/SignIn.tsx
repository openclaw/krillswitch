import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type DevPersonaOption } from "../api";
import { RoleChip } from "../components/RoleChip";

export function SignIn() {
  const queryClient = useQueryClient();

  // 403 means dev personas are disabled (the production path once a real
  // provider exists); any persona list at all means we're on a local stack.
  const personas = useQuery({
    queryKey: ["dev-personas"],
    queryFn: api.devPersonas,
    retry: false,
  });

  const login = useMutation({
    mutationFn: (persona: string) => api.devLogin(persona),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const personasDisabled =
    personas.isError &&
    personas.error instanceof ApiError &&
    personas.error.status === 403;

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <span className="wordmark">krillswitch</span>
        <h1>Admin dashboard</h1>
        {personas.isPending && <p className="muted">Checking sign-in…</p>}
        {personasDisabled && (
          <p className="muted">
            No sign-in method is available. Dev personas are disabled outside
            local development.
          </p>
        )}
        {personas.isError && !personasDisabled && (
          <p role="alert">Could not reach the krillswitch API.</p>
        )}
        {personas.isSuccess && (
          <>
            <p className="muted">
              Local development: sign in as a seeded persona.
            </p>
            <ul className="persona-list">
              {personas.data.personas.map((persona: DevPersonaOption) => (
                <li key={persona.id}>
                  <button
                    type="button"
                    className="persona-button"
                    disabled={login.isPending}
                    onClick={() => login.mutate(persona.id)}
                  >
                    <span>{persona.name}</span>
                    <RoleChip role={persona.role} />
                  </button>
                </li>
              ))}
            </ul>
            {login.isError && (
              <p role="alert">Sign-in failed. Check the API logs.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
