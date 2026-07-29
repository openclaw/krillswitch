import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useParams } from "react-router";
import { ApiError, api, type Me } from "./api";
import {
  Brandmark,
  KrillMark,
  RetryIcon,
  ShieldIcon,
} from "./components/brand";
import { BlockSkeleton } from "./components/Skeleton";
import { ChangeLogEntryPage } from "./pages/ChangeLogEntryPage";
import { ChangeLogPage } from "./pages/ChangeLogPage";
import { CreateEnvironmentPage } from "./pages/CreateEnvironmentPage";
import { CreateProjectPage } from "./pages/CreateProjectPage";
import { FlagDetailPage } from "./pages/flagDetail/FlagDetailPage";
import { NewFlagPage } from "./pages/flagDetail/NewFlagPage";
import { MemberProfilePage } from "./pages/MemberProfilePage";
import { MembersPage } from "./pages/MembersPage";
import { MintTokenPage } from "./pages/MintTokenPage";
import { NoAccess } from "./pages/NoAccess";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignIn } from "./pages/SignIn";
import { TokensPage } from "./pages/TokensPage";
import { Shell } from "./Shell";
import { useThemeMode } from "./useThemeMode";

export function App() {
  // Apply and keep the resolved theme in sync on every screen, including
  // the auth and boot states that render before the Shell mounts.
  const theme = useThemeMode();
  const me = useQuery<Me, Error>({ queryKey: ["me"], queryFn: api.me });

  if (me.isPending) {
    return (
      <div className="boot" aria-busy="true">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <SignIn />;
    }
    return (
      <div className="auth-screen">
        <div className="auth">
          <Brandmark />
          <div className="auth-card auth-card-centered">
            <span className="status-disc status-disc-accent">
              <KrillMark />
            </span>
            <h1 className="auth-title">Can't reach the API</h1>
            <p className="auth-subtitle" role="alert">
              The krillswitch service didn't respond. Check that it's running,
              then retry the connection.
            </p>
            <div className="auth-actions">
              <button
                type="button"
                className="oc-action oc-action-primary"
                disabled={me.isFetching}
                onClick={() => me.refetch()}
              >
                <RetryIcon className="oc-action oc-action-icon" />
                {me.isFetching ? "Retrying…" : "Retry connection"}
              </button>
              <a
                className="oc-action oc-action-secondary"
                href="https://github.com/openclaw/krillswitch"
                target="_blank"
                rel="noreferrer"
              >
                View status docs
              </a>
            </div>
          </div>
          <div className="auth-help">
            <span className="auth-help-icon">
              <ShieldIcon />
            </span>
            <span className="auth-help-text">
              <strong>Need help?</strong>
              Check the krillswitch documentation or open a GitHub issue.
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (me.data.role === null) {
    return <NoAccess me={me.data} />;
  }

  return (
    <Shell me={me.data} theme={theme}>
      <Routes>
        <Route path="/" element={<ProjectsPage me={me.data} />} />
        <Route
          path="/settings"
          element={<SettingsPage me={me.data} theme={theme} />}
        />
        <Route
          path="/projects/:projectKey/flags/:flagKey"
          element={<FlagRedirect />}
        />
        <Route path="/changelog" element={<ChangeLogPage />} />
        <Route path="/changelog/:id" element={<ChangeLogEntryPage />} />
        <Route
          path="/projects/:projectKey"
          element={<ProjectPage me={me.data} />}
        />
        <Route
          path="/projects/:projectKey/:environmentKey"
          element={<ProjectPage me={me.data} />}
        />
        {me.data.role === "admin" && (
          <Route path="/projects/new" element={<CreateProjectPage />} />
        )}
        {me.data.role === "admin" && (
          <Route
            path="/projects/:projectKey/environments/new"
            element={<CreateEnvironmentPage />}
          />
        )}
        {(me.data.role === "editor" || me.data.role === "admin") && (
          <Route
            path="/projects/:projectKey/:environmentKey/flags/new"
            element={<NewFlagPage />}
          />
        )}
        <Route
          path="/projects/:projectKey/:environmentKey/flags/:flagKey"
          element={<FlagDetailPage me={me.data} />}
        />
        {me.data.role === "admin" && (
          <>
            <Route
              path="/access"
              element={<Navigate to="/access/members" replace />}
            />
            <Route
              path="/access/members"
              element={<MembersPage me={me.data} />}
            />
            <Route
              path="/access/members/:userId"
              element={<MemberProfilePage me={me.data} />}
            />
            <Route path="/access/tokens" element={<TokensPage />} />
            <Route path="/access/tokens/new" element={<MintTokenPage />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

/** Palette flag links carry no environment; resolve the project's first
 *  environment and forward. */
function FlagRedirect() {
  const { projectKey = "", flagKey = "" } = useParams();
  const detail = useQuery({
    queryKey: ["project", projectKey],
    queryFn: () => api.projectDetail(projectKey),
  });
  if (detail.isPending) return <BlockSkeleton lines={3} />;
  const firstEnvironment = detail.data?.environments[0];
  if (!firstEnvironment) {
    return <Navigate to={`/projects/${projectKey}`} replace />;
  }
  return (
    <Navigate
      to={`/projects/${projectKey}/${firstEnvironment.key}/flags/${flagKey}`}
      replace
    />
  );
}
