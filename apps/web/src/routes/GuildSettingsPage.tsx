/**
 * Guild settings: owner-only rename, member roster and invite management.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { fetchMe } from "../api/auth";
import { fetchProject } from "../api/projects";
import { apiErrorMessage } from "../components/auth/apiErrorMessage";
import Icon from "../components/Icon";
import GuildNameForm from "../components/settings/GuildNameForm";
import InviteSection from "../components/settings/InviteSection";
import MemberList from "../components/settings/MemberList";
import { Button, Panel } from "../components/ui";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";

function parseProjectId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Page title with the settings pack icon. */
function SettingsTitle() {
  return (
    <div className="flex items-center gap-2">
      <Icon name="settings" size={32} />
      <h1 className="text-xl font-semibold text-ink">{ko.settings.title}</h1>
    </div>
  );
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
      <Panel className="space-y-2">
        <SettingsTitle />
        <p role="alert" className="text-sm text-brick">
          {ko.errors.notFound}
        </p>
      </Panel>
    );
  }

  if (projectQuery.isPending || meQuery.isPending) {
    return (
      <Panel className="space-y-2">
        <SettingsTitle />
        <p role="status" className="text-sm text-muted">
          {ko.common.loading}
        </p>
      </Panel>
    );
  }

  if (projectQuery.isError) {
    return (
      <Panel className="space-y-3">
        <SettingsTitle />
        <p role="alert" className="text-sm text-brick">
          {apiErrorMessage(projectQuery.error, ko.settings.loadFailed)}
        </p>
        <Button
          variant="secondary"
          icon="refresh"
          onClick={() => void projectQuery.refetch()}
        >
          {ko.common.retry}
        </Button>
      </Panel>
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
        <SettingsTitle />
        <p className="mt-1 text-sm text-muted">{ko.settings.description}</p>
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
