/**
 * Guild settings: owner-only rename, member roster and invite management.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { fetchMe } from "../api/auth";
import { fetchProject } from "../api/projects";
import { apiErrorMessage } from "../components/auth/apiErrorMessage";
import GuildNameForm from "../components/settings/GuildNameForm";
import InviteSection from "../components/settings/InviteSection";
import MemberList from "../components/settings/MemberList";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";

function parseProjectId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

export default function GuildSettingsPage() {
  const { projectId: rawProjectId } = useParams<{ projectId: string }>();
  const projectId = parseProjectId(rawProjectId);

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId ?? 0),
    queryFn: ({ signal }) => {
      if (projectId === null) {
        throw new Error("Invalid project id");
      }
      return fetchProject(projectId, signal);
    },
    enabled: projectId !== null,
    retry: false,
  });

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
  });

  if (projectId === null) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight">{ko.settings.title}</h1>
        <p role="alert" className="text-sm text-rose-300">
          {ko.errors.notFound}
        </p>
      </section>
    );
  }

  if (projectQuery.isPending || meQuery.isPending) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight">{ko.settings.title}</h1>
        <p role="status" className="text-sm text-slate-400">
          {ko.common.loading}
        </p>
      </section>
    );
  }

  if (projectQuery.isError) {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-bold tracking-tight">{ko.settings.title}</h1>
        <p role="alert" className="text-sm text-rose-300">
          {apiErrorMessage(projectQuery.error, ko.settings.loadFailed)}
        </p>
        <button
          type="button"
          onClick={() => void projectQuery.refetch()}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          {ko.common.retry}
        </button>
      </section>
    );
  }

  const detail = projectQuery.data;
  const me = meQuery.data?.user ?? null;
  const isOwner =
    me !== null &&
    detail.members.some(
      (member) => member.userId === me.id && member.role === "owner",
    );

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-xl font-bold tracking-tight">{ko.settings.title}</h1>
        <p className="mt-1 text-sm text-slate-400">{ko.settings.description}</p>
      </header>

      <GuildNameForm
        projectId={detail.project.id}
        projectName={detail.project.name}
        isOwner={isOwner}
      />

      <MemberList members={detail.members} />

      <InviteSection projectId={detail.project.id} />
    </section>
  );
}
