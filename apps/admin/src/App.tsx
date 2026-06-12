import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router";
import { ApiError, api, type Me } from "./api";
import { AccessPage } from "./pages/AccessPage";
import { NoAccess } from "./pages/NoAccess";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SignIn } from "./pages/SignIn";
import { Shell } from "./Shell";

export function App() {
  const me = useQuery<Me, Error>({ queryKey: ["me"], queryFn: api.me });

  if (me.isPending) {
    return <div className="boot" aria-busy="true" />;
  }

  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <SignIn />;
    }
    return (
      <div className="boot">
        <p role="alert">Could not reach the krillswitch API.</p>
      </div>
    );
  }

  if (me.data.role === null) {
    return <NoAccess me={me.data} />;
  }

  return (
    <Shell me={me.data}>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        {me.data.role === "admin" && (
          <Route path="/access" element={<AccessPage />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
