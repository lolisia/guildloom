/**
 * Top navigation: one tab per guild the adventurer belongs to, a create-guild
 * action, board/ledger/settings toggles and the adventurer summary
 * (sprite, name, level, XP bar, theme menu, logout).
 *
 * Styling follows DESIGN.md: a sticky paper bar over a 1.5px `line-strong`
 * rule, outlined ground-filled tabs for the current guild/view, 32px pack
 * icons with visible Korean labels, and a gold XP bar that is the only reward
 * accent in the shell.
 */
import { levelFromXp, levelProgress } from "@guildloom/shared";
import type { MeResponse, Project, ProjectSummary } from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { fetchMe, logout } from "../api/auth";
import { createProject, fetchProjects } from "../api/projects";
import { ko } from "../i18n/ko";
import { isImeComposing } from "../lib/ime";
import { queryKeys } from "../lib/queryKeys";
import AdventurerSprite from "./AdventurerSprite";
import Icon from "./Icon";
import NotificationsMenu from "./NotificationsMenu";
import ThemeMenu from "./ThemeMenu";
import { Button, TextInput } from "./ui";

const MAX_GUILD_NAME_LENGTH = 40;

/** Shared box for guild and view tabs; the active state adds the outline. */
const TAB_BASE_CLASSES =
  "inline-flex h-8 items-center rounded-sm text-sm transition-colors";
const GUILD_TAB_CLASSES = `${TAB_BASE_CLASSES} max-w-44 px-2.5 font-medium`;
const VIEW_TAB_CLASSES = `${TAB_BASE_CLASSES} gap-1.5 px-2.5`;
const ACTIVE_TAB_CLASSES =
  "border-[1.5px] border-line-strong bg-ground text-ink";
const INACTIVE_TAB_CLASSES = "text-muted hover:bg-sunken hover:text-ink";

/** Compose the tab classes from its base and active/inactive treatment. */
function tabClasses(base: string, isActive: boolean): string {
  return `${base} ${isActive ? ACTIVE_TAB_CLASSES : INACTIVE_TAB_CLASSES}`;
}

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

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
  });
  const user = meQuery.data?.user ?? null;

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => fetchProjects(signal),
    retry: false,
    // Belt and braces around logout: the settled handler removes every guild
    // query, and the brief render before the route swaps to /login must not
    // rebuild the project cache (and fire a 401 request). Only a signed-in
    // adventurer needs the guild list.
    enabled: user !== null,
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
      // The QueryClient outlives the session (30s staleTime / 5min gcTime),
      // so drop every guild query — notifications and pending nominations
      // included — before another account can sign in on this browser. Only
      // the public setup status and the explicit null `me` survive.
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey[0] !== queryKeys.setupStatus[0] &&
          query.queryKey[0] !== queryKeys.me[0],
      });
      // Drop the session view immediately; the gate then renders /login.
      queryClient.setQueryData<MeResponse | null>(queryKeys.me, null);
      navigate("/login", { replace: true });
    },
  });

  const projects: ProjectSummary[] = projectsQuery.data ?? [];
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

  // The dialog has a single text input, so an Enter that confirms an IME
  // candidate would implicitly submit the form. Cancel only that Enter; a
  // regular Enter still submits.
  const handleGuildNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && isImeComposing(event)) {
      event.preventDefault();
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b-[1.5px] border-line-strong bg-paper">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <Link
          to="/"
          className="shrink-0 font-pixel text-[16px] leading-none text-ink"
        >
          {ko.common.appName}
        </Link>

        <nav
          aria-label={ko.tabs.projectList}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
        >
          {projectsQuery.isPending ? (
            <span className="text-xs text-muted">{ko.common.loading}</span>
          ) : null}

          {projectsQuery.isError ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-brick">
                {ko.errors.loadFailed}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void projectsQuery.refetch()}
              >
                {ko.common.retry}
              </Button>
            </div>
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
                className={tabClasses(GUILD_TAB_CLASSES, isActive)}
              >
                <span className="min-w-0 truncate">{project.name}</span>
              </Link>
            );
          })}

          <Button
            variant="secondary"
            icon="add"
            aria-label={ko.tabs.createGuild}
            title={ko.tabs.createGuild}
            onClick={openCreateDialog}
          >
            {ko.tabs.createGuild}
          </Button>
        </nav>

        {activeProjectId !== null ? (
          <nav
            aria-label={ko.tabs.viewToggle}
            className="flex items-center gap-1"
          >
            <Link
              to={`/g/${activeProjectId}`}
              aria-current={isBoard ? "page" : undefined}
              className={tabClasses(VIEW_TAB_CLASSES, isBoard)}
            >
              <Icon name="board" size={32} />
              <span>{ko.tabs.board}</span>
            </Link>
            <Link
              to={`/g/${activeProjectId}/ledger`}
              aria-current={isLedger ? "page" : undefined}
              className={tabClasses(VIEW_TAB_CLASSES, isLedger)}
            >
              <Icon name="ledger" size={32} />
              <span>{ko.tabs.ledger}</span>
            </Link>
            <Link
              to={`/g/${activeProjectId}/settings`}
              aria-current={isSettings ? "page" : undefined}
              className={tabClasses(VIEW_TAB_CLASSES, isSettings)}
            >
              <Icon name="settings" size={32} />
              <span>{ko.tabs.settings}</span>
            </Link>
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          {user && progress && level !== null ? (
            <div className="flex items-center gap-2">
              <AdventurerSprite
                userId={user.id}
                displayName={user.displayName}
                size="sm"
              />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="max-w-32 truncate text-sm font-medium text-ink">
                    {user.displayName}
                  </span>
                  <span className="font-pixel text-[12px] text-gold">
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
                  className="mt-1 h-2 w-24 border-[1.5px] border-line-strong bg-sunken"
                >
                  <div
                    className="h-full bg-gold-fill transition-[width]"
                    style={{ width: `${xpPercent}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {user ? <NotificationsMenu /> : null}

          <ThemeMenu />

          {user ? (
            <Button
              variant="ghost"
              icon="logout"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              {logoutMutation.isPending
                ? ko.tabs.loggingOut
                : ko.tabs.logout}
            </Button>
          ) : null}
        </div>
      </div>

      {isCreateOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
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
                className="w-full max-w-sm rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
              >
                <form onSubmit={handleCreateSubmit} className="space-y-4">
                  <div>
                    <h2
                      id={dialogTitleId}
                      className="text-base font-semibold text-ink"
                    >
                      {ko.tabs.createGuildTitle}
                    </h2>
                    <p className="mt-1 text-xs text-muted">
                      {ko.tabs.createGuildDescription}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={guildNameInputId}
                      className="block text-xs font-medium text-ink"
                    >
                      {ko.tabs.guildName}
                    </label>
                    <TextInput
                      id={guildNameInputId}
                      value={guildName}
                      onChange={(event) => setGuildName(event.target.value)}
                      onKeyDown={handleGuildNameKeyDown}
                      placeholder={ko.tabs.guildNamePlaceholder}
                      maxLength={MAX_GUILD_NAME_LENGTH}
                      autoFocus
                    />
                  </div>

                  {createMutation.isError ? (
                    <p role="alert" className="text-xs text-brick">
                      {ko.tabs.createFailed}
                    </p>
                  ) : null}

                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={closeCreateDialog}>
                      {ko.common.cancel}
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!guildName.trim() || createMutation.isPending}
                    >
                      {createMutation.isPending
                        ? ko.tabs.creating
                        : ko.common.create}
                    </Button>
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
