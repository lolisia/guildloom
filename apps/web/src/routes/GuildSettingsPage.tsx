/**
 * Guild settings placeholder.
 *
 * T07/T08 replace this file with member/invite management; the router already
 * mounts it at `/g/:projectId/settings`.
 */
import { useParams } from "react-router-dom";

import { ko } from "../i18n/ko";

export default function GuildSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <section className="space-y-2">
      <h1 className="text-xl font-bold tracking-tight">{ko.settings.title}</h1>
      <p className="text-sm text-slate-400">{ko.settings.description}</p>
      <p className="text-xs text-slate-500">
        {ko.settings.projectLabel(projectId ?? "")}
      </p>
      <p className="text-xs text-slate-500">{ko.common.comingSoon}</p>
    </section>
  );
}
