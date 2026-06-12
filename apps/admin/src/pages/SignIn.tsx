import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type DevPersonaOption } from "../api";
import { RoleChip } from "../components/RoleChip";

export function SignIn() {
  const queryClient = useQueryClient();

  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: api.authProviders,
    retry: false,
  });

  const github = useMutation({
    mutationFn: api.signInWithGitHub,
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  const personas = useQuery({
    queryKey: ["dev-personas"],
    queryFn: api.devPersonas,
    enabled: providers.data?.devPersonas === true,
    retry: false,
  });

  const login = useMutation({
    mutationFn: (persona: string) => api.devLogin(persona),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const noProviders =
    providers.isSuccess &&
    !providers.data.github &&
    !providers.data.devPersonas;

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <span className="wordmark">krillswitch</span>
        <h1>Admin dashboard</h1>
        {providers.isPending && <p className="muted">Checking sign-in…</p>}
        {providers.isError && (
          <p role="alert">Could not reach the krillswitch API.</p>
        )}
        {noProviders && (
          <p className="muted">
            No sign-in method is configured. Set GitHub OAuth credentials, or
            enable dev personas for local development.
          </p>
        )}
        {providers.data?.github && (
          <>
            <button
              type="button"
              className="btn btn-primary btn-github"
              disabled={github.isPending}
              onClick={() => github.mutate()}
            >
              Continue with GitHub
            </button>
            {github.isError && (
              <p role="alert">GitHub sign-in failed. Check the API logs.</p>
            )}
          </>
        )}
        {providers.data?.devPersonas && (
          <>
            <p className="muted">
              Local development: sign in as a seeded persona.
            </p>
            {personas.isSuccess && (
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
            )}
            {login.isError && (
              <p role="alert">Sign-in failed. Check the API logs.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
