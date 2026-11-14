/**
 * Shell for every authenticated guild screen: the sticky header/tab bar plus
 * the routed page below it.
 *
 * Visiting any `/g/:projectId` route records the guild in `gl:lastProject` so
 * `/` can send the adventurer back to where they were.
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <TabBar />
      <main className="mx-auto w-full max-w-screen-2xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
