/**
 * Application routes and setup/auth guards.
 *
 * Startup rules:
 * - `GET /api/setup/status` and `GET /api/auth/me` run once with `retry: false`.
 * - While setup is required, every route except `/invite/:code` redirects to
 *   `/setup`.
 * - Once setup is complete, signed-in adventurers visiting `/setup` (or
 *   `/login`) go home; signed-out adventurers go to `/login` everywhere except
 *   the public invite route.
 */
import { useQuery } from "@tanstack/react-query";
import {
  matchPath,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import { fetchMe, fetchSetupStatus } from "./api/auth";
import AppLayout from "./components/AppLayout";
import { ko } from "./i18n/ko";
import { queryKeys } from "./lib/queryKeys";
import BoardPage from "./routes/BoardPage";
import GuildSettingsPage from "./routes/GuildSettingsPage";
import InvitePage from "./routes/InvitePage";
import LedgerPage from "./routes/LedgerPage";
import LoginPage from "./routes/LoginPage";
import RootRedirect from "./routes/RootRedirect";
import SetupPage from "./routes/SetupPage";

/** Canonical route paths so later tasks do not hard-code strings. */
export const routePaths = {
  home: "/",
  setup: "/setup",
  login: "/login",
  invite: (code: string) => `/invite/${encodeURIComponent(code)}`,
  project: (projectId: number | string) => `/g/${projectId}`,
  ledger: (projectId: number | string) => `/g/${projectId}/ledger`,
  settings: (projectId: number | string) => `/g/${projectId}/settings`,
} as const;

const INVITE_ROUTE = { path: "/invite/:code", end: true } as const;

function isInvitePath(pathname: string): boolean {
  return matchPath(INVITE_ROUTE, pathname) !== null;
}

function LoadingScreen() {
  return (
    <div
      role="status"
      className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400"
    >
      {ko.common.loading}
    </div>
  );
}

function ShellErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 px-4 text-center">
      <p className="text-sm text-rose-300">{ko.errors.loadFailed}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
      >
        {ko.common.retry}
      </button>
    </div>
  );
}

/**
 * Bootstrap gate: fetch setup/auth state once, then redirect or render the
 * matched child route. Invite links stay public so newcomers can join before
 * signing in.
 */
export function AppGate() {
  const location = useLocation();

  const setupStatusQuery = useQuery({
    queryKey: queryKeys.setupStatus,
    queryFn: ({ signal }) => fetchSetupStatus(signal),
    retry: false,
  });

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
  });

  // Public invite links render regardless of setup/auth state (the queries
  // above still start so a signed-in visitor is recognised immediately).
  if (isInvitePath(location.pathname)) {
    return <Outlet />;
  }

  if (setupStatusQuery.isPending) {
    return <LoadingScreen />;
  }

  if (setupStatusQuery.isError) {
    return (
      <ShellErrorScreen
        onRetry={() => {
          void setupStatusQuery.refetch();
        }}
      />
    );
  }

  const needsSetup = setupStatusQuery.data.needsSetup;

  if (needsSetup) {
    if (location.pathname === routePaths.setup) {
      return <Outlet />;
    }
    return <Navigate to={routePaths.setup} replace />;
  }

  if (meQuery.isPending) {
    return <LoadingScreen />;
  }

  const user = meQuery.data?.user ?? null;

  if (user) {
    if (
      location.pathname === routePaths.setup ||
      location.pathname === routePaths.login
    ) {
      return <Navigate to={routePaths.home} replace />;
    }
    return <Outlet />;
  }

  if (location.pathname === routePaths.login) {
    return <Outlet />;
  }

  return <Navigate to={routePaths.login} replace />;
}

/** All M1 routes. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppGate />}>
        <Route path={routePaths.setup} element={<SetupPage />} />
        <Route path={routePaths.login} element={<LoginPage />} />
        <Route path="/invite/:code" element={<InvitePage />} />

        <Route element={<AppLayout />}>
          <Route path={routePaths.home} element={<RootRedirect />} />
          <Route path="/g/:projectId" element={<BoardPage />} />
          <Route path="/g/:projectId/ledger" element={<LedgerPage />} />
          <Route path="/g/:projectId/settings" element={<GuildSettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to={routePaths.home} replace />} />
      </Route>
    </Routes>
  );
}
