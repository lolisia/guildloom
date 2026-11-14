/**
 * Board placeholder.
 *
 * T07 replaces this file with the four-column board; the router already
 * mounts it at `/g/:projectId`.
 */
import { useParams } from "react-router-dom";

import { ko } from "../i18n/ko";

export default function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <section className="space-y-2">
      <h1 className="text-xl font-bold tracking-tight">{ko.board.title}</h1>
      <p className="text-sm text-slate-400">
        {ko.quest.projectLabel(projectId ?? "")}
      </p>
      <p className="text-xs text-slate-500">{ko.common.comingSoon}</p>
    </section>
  );
}
