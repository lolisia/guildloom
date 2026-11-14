/**
 * Ledger placeholder.
 *
 * T07/T08 replace this file with the quest table; the router already mounts
 * it at `/g/:projectId/ledger`.
 */
import { useParams } from "react-router-dom";

import { ko } from "../i18n/ko";

export default function LedgerPage() {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <section className="space-y-2">
      <h1 className="text-xl font-bold tracking-tight">{ko.ledger.title}</h1>
      <p className="text-sm text-slate-400">{ko.ledger.description}</p>
      <p className="text-xs text-slate-500">
        {ko.quest.projectLabel(projectId ?? "")}
      </p>
      <p className="text-xs text-slate-500">{ko.common.comingSoon}</p>
    </section>
  );
}
