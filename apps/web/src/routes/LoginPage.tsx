/**
 * Login screen placeholder.
 *
 * T07/T08 replace this file with the real form; the router already mounts it
 * at `/login`.
 */
import { ko } from "../i18n/ko";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <h1 className="text-2xl font-black tracking-tight">{ko.login.title}</h1>
        <p className="mt-2 text-sm text-slate-400">{ko.login.description}</p>
        <p className="mt-6 text-xs text-slate-500">{ko.common.comingSoon}</p>
      </section>
    </main>
  );
}
