/**
 * `/` → the last visited guild (when it still belongs to the adventurer) or
 * the first guild returned by `GET /api/projects`.
 */
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { fetchProjects } from "../api/projects";
import { LAST_PROJECT_STORAGE_KEY } from "../components/AppLayout";
import { Button, EmptyState } from "../components/ui";
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
      <p role="status" className="text-sm text-muted">
        {ko.common.loading}
      </p>
    );
  }

  if (projectsQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-brick">{ko.errors.loadFailed}</p>
        <Button
          variant="secondary"
          icon="refresh"
          onClick={() => {
            void projectsQuery.refetch();
          }}
        >
          {ko.common.retry}
        </Button>
      </div>
    );
  }

  const firstProject = projectsQuery.data[0];
  if (!firstProject) {
    return (
      <EmptyState
        icon="guild"
        text={ko.common.noProjects}
        action={<p className="text-xs text-muted">{ko.common.noProjectsHint}</p>}
      />
    );
  }

  const lastProjectId = readLastProjectId();
  const target =
    (lastProjectId !== null
      ? projectsQuery.data.find((project) => project.id === lastProjectId)
      : undefined) ?? firstProject;

  return <Navigate to={`/g/${target.id}`} replace />;
}
