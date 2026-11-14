/**
 * Centered card used by the unauthenticated screens (setup, login, invite).
 */
import type { ReactNode } from "react";

export interface AuthPanelProps {
  /** Page title, rendered as the level-1 heading. */
  title: string;
  /** One-line invitation, e.g. "모험을 시작하세요". */
  heading?: string;
  /** Supporting explanation below the heading. */
  description?: string;
  children?: ReactNode;
}

/** Dark, centered auth card shared by setup, login and invite. */
export function AuthPanel({
  title,
  heading,
  description,
  children,
}: AuthPanelProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <h1 className="text-2xl font-black tracking-tight">{title}</h1>
        {heading ? (
          <p className="mt-3 text-sm font-semibold text-emerald-300">
            {heading}
          </p>
        ) : null}
        {description ? (
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        ) : null}
        {children ? <div className="mt-6 space-y-5">{children}</div> : null}
      </section>
    </main>
  );
}

export default AuthPanel;
