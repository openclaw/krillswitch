import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { type AdminRole, api, type DevPersonaOption } from "../api";
import krillBanner from "../assets/krill-banner.avif";
import {
  ArrowRightIcon,
  Brandmark,
  ChevronRightIcon,
  EyeIcon,
  LockIcon,
  PencilIcon,
  ShieldIcon,
} from "../components/brand";

type RoleKey = AdminRole | "none";

const ROLE_META: Record<RoleKey, { description: string; icon: ReactNode }> = {
  admin: {
    description: "Full access to all features and settings",
    icon: <ShieldIcon />,
  },
  editor: {
    description: "Create and manage flags and projects",
    icon: <PencilIcon />,
  },
  viewer: {
    description: "View flags, projects, and analytics",
    icon: <EyeIcon />,
  },
  none: { description: "No access to the system", icon: <LockIcon /> },
};

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

  const hasPersonas = providers.data?.devPersonas === true;
  const noProviders =
    providers.isSuccess &&
    !providers.data.github &&
    !providers.data.devPersonas;

  return (
    <div className="auth-screen">
      {/* Carapace brand banner: the krill artwork rises from the bottom of
          the viewport behind the card, top edge dissolved by the fade. */}
      <div
        className="oc-brand-banner auth-banner"
        data-anchor="bottom"
        data-effect="fade"
        aria-hidden="true"
      >
        <div className="oc-brand-banner-art">
          <img src={krillBanner} alt="" />
        </div>
      </div>
      <div className="auth">
        <Brandmark />
        <div className="auth-card">
          <div className="auth-card-head">
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-subtitle">
              {hasPersonas
                ? "Sign in as a seeded persona to continue"
                : "Sign in to continue"}
            </p>
          </div>

          {providers.isPending && (
            <p className="auth-subtitle">Checking sign-in…</p>
          )}
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
                className="oc-action oc-action-primary btn-github"
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

          {hasPersonas && personas.isSuccess && (
            <ul className="persona-list">
              {personas.data.personas.map((persona: DevPersonaOption) => {
                const roleKey: RoleKey = persona.role ?? "none";
                const meta = ROLE_META[roleKey];
                return (
                  <li key={persona.id}>
                    <button
                      type="button"
                      className="persona-card"
                      disabled={login.isPending}
                      onClick={() => login.mutate(persona.id)}
                    >
                      <span className={`persona-icon role-${roleKey}`}>
                        {meta.icon}
                      </span>
                      <span className="persona-text">
                        <span className="persona-name">{persona.name}</span>
                        <span className="persona-desc">{meta.description}</span>
                      </span>
                      <span className="persona-meta">
                        <ChevronRightIcon className="persona-chevron" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {login.isError && (
            <p role="alert">Sign-in failed. Check the API logs.</p>
          )}

          <div className="auth-footer">
            <span className="muted">
              {hasPersonas ? "Local development only." : "Admin access only."}
            </span>
            <a
              className="auth-learn"
              href="https://github.com/openclaw/krillswitch"
              target="_blank"
              rel="noreferrer"
            >
              Learn more about krillswitch
              <ArrowRightIcon className="auth-learn-arrow" />
            </a>
          </div>
        </div>
        <footer className="auth-colophon">
          <p>
            An{" "}
            <a
              href="https://openclaw.ai"
              target="_blank"
              rel="noreferrer noopener"
            >
              OpenClaw Foundation
            </a>{" "}
            project — open source feature flags for agents and apps.
          </p>
        </footer>
      </div>
    </div>
  );
}
