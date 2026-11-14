/**
 * Shell for every authenticated guild screen: the sticky header/tab bar plus
 * the routed page below it.
 *
 * Visiting any `/g/:projectId` route records the guild in `gl:lastProject` so
 * `/` can send the adventurer back to where they were.
 *
 * The shell sits on the ground surface with the paper top bar above it
 * (DESIGN.md): depth comes from the ground/paper/sunken steps, not shadows.
 */
import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";

import TabBar from "./TabBar";

/** localStorage key holding the last visited project id. */
export const LAST_PROJECT_STORAGE_KEY = "gl:lastProject";

export function AppLayout() {
  const { projectId } = useParams<{ projectId: string }>();

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
      <main className="mx-auto w-full max-w-screen-2xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
