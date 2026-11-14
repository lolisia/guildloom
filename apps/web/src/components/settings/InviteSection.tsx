/**
 * Invite link management for a guild.
 *
 * Members can mint reusable invite links, copy the absolute URL to the
 * clipboard and revoke links they no longer want to hand out. Every mutation
 * invalidates `queryKeys.invites(projectId)` so the list reflects the server.
 */
import type { CreateInviteResponse, Invite } from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createInvite, fetchInvites, revokeInvite } from "../../api/invites";
import { ko } from "../../i18n/ko";
import { queryKeys } from "../../lib/queryKeys";
import { apiErrorMessage } from "../auth/apiErrorMessage";
import FormAlert from "../auth/FormAlert";
import CopyInviteButton from "./CopyInviteButton";

export interface InviteSectionProps {
  projectId: number;
}

/** Invite creation, clipboard copy and revocation. */
export function InviteSection({ projectId }: InviteSectionProps) {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<CreateInviteResponse | null>(null);

  const invitesQuery = useQuery({
    queryKey: queryKeys.invites(projectId),
    queryFn: ({ signal }) => fetchInvites(projectId, signal),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: () => createInvite(projectId),
    onSuccess: (invite) => {
      setCreated(invite);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.invites(projectId),
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: number) => revokeInvite(projectId, inviteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.invites(projectId),
      });
    },
  });

  const handleRevoke = (inviteId: number) => {
    if (revokeMutation.isPending) {
      return;
    }
    if (!window.confirm(ko.settings.revokeConfirm)) {
      return;
    }
    revokeMutation.mutate(inviteId);
  };

  const invites: Invite[] = invitesQuery.data ?? [];
  const revokingId = revokeMutation.isPending
    ? revokeMutation.variables
    : undefined;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-200">
            {ko.settings.invites}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {ko.settings.invitesDescription}
          </p>
        </div>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createMutation.isPending
            ? ko.settings.creatingInvite
            : ko.settings.createInvite}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <FormAlert
          message={
            createMutation.isError
              ? apiErrorMessage(
                  createMutation.error,
                  ko.settings.inviteCreateFailed,
                )
              : null
          }
        />
        <FormAlert
          message={
            revokeMutation.isError
              ? apiErrorMessage(
                  revokeMutation.error,
                  ko.settings.revokeFailed,
                )
              : null
          }
        />

        {created ? (
          <div
            data-testid="created-invite"
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3"
          >
            <p className="text-xs font-medium text-emerald-300">
              {ko.settings.inviteUrl}
            </p>
            <p className="mt-1 text-sm font-bold tracking-wide text-slate-100">
              {created.code}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="break-all rounded bg-slate-950 px-2 py-1 text-xs text-slate-300">
                {`${window.location.origin}${created.url}`}
              </code>
              <CopyInviteButton url={created.url} />
            </div>
          </div>
        ) : null}

        {invitesQuery.isPending ? (
          <p role="status" className="text-xs text-slate-400">
            {ko.common.loading}
          </p>
        ) : null}

        {invitesQuery.isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-xs text-rose-300">
              {ko.settings.invitesLoadFailed}
            </p>
            <button
              type="button"
              onClick={() => void invitesQuery.refetch()}
              className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              {ko.common.retry}
            </button>
          </div>
        ) : null}

        {!invitesQuery.isPending && !invitesQuery.isError ? (
          invites.length === 0 ? (
            <p className="text-xs text-slate-500">{ko.settings.inviteEmpty}</p>
          ) : (
            <ul className="space-y-2">
              {invites.map((invite) => {
                const active = invite.revokedAt === null;
                return (
                  <li
                    key={invite.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-emerald-300">
                        {invite.code}
                      </code>
                      <span
                        data-status={active ? "active" : "revoked"}
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          active
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {active ? ko.settings.active : ko.settings.revoked}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {ko.settings.createdBy(invite.createdBy.displayName)}
                      </span>
                      <time
                        className="text-[11px] text-slate-500"
                        dateTime={new Date(invite.createdAt).toISOString()}
                      >
                        {ko.time.relative(invite.createdAt)}
                      </time>
                    </div>

                    <p className="mt-1 break-all text-[11px] text-slate-400">
                      {`${window.location.origin}${invite.url}`}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {active ? (
                        <>
                          <CopyInviteButton url={invite.url} />
                          <button
                            type="button"
                            onClick={() => handleRevoke(invite.id)}
                            disabled={revokingId === invite.id}
                            className="rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {revokingId === invite.id
                              ? ko.settings.revokingInvite
                              : ko.settings.revokeInvite}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>
    </section>
  );
}

export default InviteSection;
