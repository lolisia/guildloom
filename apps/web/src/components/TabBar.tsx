/**
 * Top navigation: one tab per guild the adventurer belongs to, a create-guild
 * action, board/ledger/settings toggles and the adventurer summary
 * (sprite, name, level, XP bar, logout).
 */
import { levelFromXp, levelProgress } from "@guildloom/shared";
import type { MeResponse, Project, ProjectSummary } from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { fetchMe, logout } from "../api/auth";
import { createProject, fetchProjects } from "../api/projects";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";
import AdventurerSprite from "./AdventurerSprite";

const MAX_GUILD_NAME_LENGTH = 40;

function parseProjectId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

export function TabBar() {
  const { projectId } = useParams<{ projectId: string }>();
  const activeProjectId = parseProjectId(projectId);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [isCreateOpen, setCreateOpen] = useState(false);
  const [guildName, setGuildName] = useState("");
  const dialogTitleId = useId();
  const guildNameInputId = useId();

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => fetchProjects(signal),
    retry: false,
  });

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createProject({ name }),
    onSuccess: async (project: Project) => {
      setGuildName("");
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      navigate(`/g/${project.id}`);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      // Drop the session view immediately; the gate then renders /login.
      queryClient.setQueryData<MeResponse | null>(queryKeys.me, null);
      queryClient.removeQueries({ queryKey: queryKeys.projects });
      navigate("/login", { replace: true });
    },
  });

  const projects: ProjectSummary[] = projectsQuery.data ?? [];
  const user = meQuery.data?.user ?? null;
  const progress = user ? levelProgress(user.xp) : null;
  const level = user ? levelFromXp(user.xp) : null;
  const xpPercent =
    progress && progress.next > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((progress.current / progress.next) * 100)),
        )
      : 0;

  const isBoard =
    activeProjectId !== null &&
    location.pathname === `/g/${activeProjectId}`;
  const isLedger =
    activeProjectId !== null &&
    location.pathname === `/g/${activeProjectId}/ledger`;
  const isSettings =
    activeProjectId !== null &&
    location.pathname === `/g/${activeProjectId}/settings`;

  const openCreateDialog = () => {
    createMutation.reset();
    setGuildName("");
    setCreateOpen(true);
  };

  const closeCreateDialog = () => {
    if (createMutation.isPending) {
      return;
    }
    setCreateOpen(false);
  };

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      closeCreateDialog();
    }
  };

  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = guildName.trim();
    if (!name || createMutation.isPending) {
      return;
    }
    createMutation.mutate(name);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link
          to="/"
          className="flex items-center gap-1 text-sm font-black tracking-tight text-emerald-400"
        >
          <span aria-hidden="true">⚔</span>
          {ko.common.appName}
        </Link>

        <nav
          aria-label={ko.tabs.projectList}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
        >
          {projectsQuery.isPending ? (
            <span className="text-xs text-slate-500">{ko.common.loading}</span>
          ) : null}

          {projectsQuery.isError ? (
            <button
              type="button"
              onClick={() => void projectsQuery.refetch()}
              className="rounded-md px-2 py-1 text-xs text-rose-300 hover:bg-slate-800"
            >
              {ko.errors.loadFailed} · {ko.common.retry}
            </button>
          ) : null}

          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <Link
                key={project.id}
                to={`/g/${project.id}`}
                data-role={project.role}
                aria-current={isActive ? "page" : undefined}
                title={
                  project.role === "owner" ? ko.tabs.owner : ko.tabs.member
                }
                className={`max-w-44 truncate rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                {project.name}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={openCreateDialog}
            aria-label={ko.tabs.createGuild}
            title={ko.tabs.createGuild}
            className="rounded-md border border-dashed border-slate-700 px-2 py-0.5 text-sm leading-5 text-slate-400 transition-colors hover:border-emerald-500/60 hover:text-emerald-300"
          >
            +
          </button>
        </nav>

        {activeProjectId !== null ? (
          <nav
            aria-label={ko.tabs.viewToggle}
            className="flex items-center rounded-lg bg-slate-900 p-0.5 text-xs"
          >
            <Link
              to={`/g/${activeProjectId}`}
              aria-current={isBoard ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                isBoard
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {ko.tabs.board}
            </Link>
            <Link
              to={`/g/${activeProjectId}/ledger`}
              aria-current={isLedger ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                isLedger
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {ko.tabs.ledger}
            </Link>
            <Link
              to={`/g/${activeProjectId}/settings`}
              aria-current={isSettings ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                isSettings
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {ko.tabs.settings}
            </Link>
          </nav>
        ) : null}

        {user && progress && level !== null ? (
          <div className="flex items-center gap-2">
            <AdventurerSprite
              userId={user.id}
              displayName={user.displayName}
              size="sm"
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="max-w-32 truncate text-xs font-semibold text-slate-200">
                  {user.displayName}
                </span>
                <span className="text-[11px] font-bold text-amber-300">
                  {ko.tabs.level(level)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={ko.tabs.xpLabel}
                aria-valuemin={0}
                aria-valuemax={progress.next}
                aria-valuenow={progress.current}
                title={ko.tabs.xp(progress.current, progress.next)}
                className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-800"
              >
                <div
                  className="h-full rounded-full bg-amber-400 transition-[width]"
                  style={{ width: `${xpPercent}%` }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {user ? (
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            {logoutMutation.isPending
              ? ko.tabs.loggingOut
              : ko.tabs.logout}
          </button>
        ) : null}
      </div>

      {isCreateOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
              onMouseDown={handleOverlayMouseDown}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeCreateDialog();
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
              >
                <form onSubmit={handleCreateSubmit} className="space-y-4">
                  <div>
                    <h2 id={dialogTitleId} className="text-base font-bold">
                      {ko.tabs.createGuildTitle}
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      {ko.tabs.createGuildDescription}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={guildNameInputId}
                      className="block text-xs font-medium text-slate-300"
                    >
                      {ko.tabs.guildName}
                    </label>
                    <input
                      id={guildNameInputId}
                      value={guildName}
                      onChange={(event) => setGuildName(event.target.value)}
                      placeholder={ko.tabs.guildNamePlaceholder}
                      maxLength={MAX_GUILD_NAME_LENGTH}
                      autoFocus
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/70"
                    />
                  </div>

                  {createMutation.isError ? (
                    <p role="alert" className="text-xs text-rose-300">
                      {ko.tabs.createFailed}
                    </p>
                  ) : null}

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeCreateDialog}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    >
                      {ko.common.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={!guildName.trim() || createMutation.isPending}
                      className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {createMutation.isPending
                        ? ko.tabs.creating
                        : ko.common.create}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </header>
  );
}

export default TabBar;
