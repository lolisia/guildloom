/**
 * `/` → the last visited guild (when it still belongs to the adventurer) or
 * the first guild returned by `GET /api/projects`.
 */
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { fetchProjects } from "../api/projects";
import { LAST_PROJECT_STORAGE_KEY } from "../components/AppLayout";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";

function readLastProjectId(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export default function RootRedirect() {
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => fetchProjects(signal),
    retry: false,
  });

  if (projectsQuery.isPending) {
    return (
      <p role="status" className="text-sm text-slate-400">
        {ko.common.loading}
      </p>
    );
  }

  if (projectsQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-rose-300">{ko.errors.loadFailed}</p>
        <button
          type="button"
          onClick={() => {
            void projectsQuery.refetch();
          }}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          {ko.common.retry}
        </button>
      </div>
    );
  }

  const firstProject = projectsQuery.data[0];
  if (!firstProject) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center">
        <p className="text-sm font-medium text-slate-300">
          {ko.common.noProjects}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {ko.common.noProjectsHint}
        </p>
      </div>
    );
  }

  const lastProjectId = readLastProjectId();
  const target =
    (lastProjectId !== null
      ? projectsQuery.data.find((project) => project.id === lastProjectId)
      : undefined) ?? firstProject;

  return <Navigate to={`/g/${target.id}`} replace />;
}
