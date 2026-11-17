/**
 * Shell for every authenticated guild screen: the sticky header/tab bar plus
 * the routed page below it.
 *
 * Visiting any `/g/:projectId` route records the guild in `gl:lastProject` so
 * `/` can send the adventurer back to where they were.
 *
 * The shell sits on the ground surface with the paper top bar above it
 * (DESIGN.md): depth comes from the ground/paper/sunken steps, not shadows.
 * It also owns the authenticated-side realtime connection, the toast stack and
 * the single LEVEL UP! modal.
 */
import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";

import { useRealtime } from "../lib/realtime";
import LevelUpModal from "./LevelUpModal";
import TabBar from "./TabBar";
import ToastHost from "./ToastHost";

/** localStorage key holding the last visited project id. */
export const LAST_PROJECT_STORAGE_KEY = "gl:lastProject";

/** Parse the route's guild id, or `null` outside a guild route. */
function parseProjectId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function AppLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const activeProjectId = parseProjectId(projectId);

  useRealtime(activeProjectId);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    try {
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId);
    } catch {
      // Storage can be unavailable (private mode); navigation still works.
    }
  }, [projectId]);

  return (
    <div className="min-h-screen bg-ground font-body text-ink">
      <TabBar />
      <main className="w-full p-4">
        <Outlet />
      </main>
      <ToastHost />
      <LevelUpModal />
    </div>
  );
}

export default AppLayout;
