/**
 * Public invite landing page placeholder.
 *
 * T07/T08 replace this file with the join/signup flows; the router already
 * mounts it at `/invite/:code` without requiring setup or a session.
 */
import { useParams } from "react-router-dom";

import { ko } from "../i18n/ko";

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <h1 className="text-2xl font-black tracking-tight">{ko.invite.title}</h1>
        <p className="mt-2 text-sm text-slate-400">{ko.invite.description}</p>
        <p className="mt-6 text-xs text-slate-400">
          {ko.invite.code}:{" "}
          <code className="rounded bg-slate-950 px-1.5 py-0.5 text-emerald-300">
            {code ?? ""}
          </code>
        </p>
        <p className="mt-6 text-xs text-slate-500">{ko.common.comingSoon}</p>
      </section>
    </main>
  );
}
