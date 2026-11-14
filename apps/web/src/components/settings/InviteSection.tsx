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
import Icon from "../Icon";
import { Button, Panel } from "../ui";
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
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {ko.settings.invites}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {ko.settings.invitesDescription}
          </p>
        </div>
        <Button
          variant="primary"
          icon="invite"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending
            ? ko.settings.creatingInvite
            : ko.settings.createInvite}
        </Button>
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
            className="rounded-sm border-[1.5px] border-teal bg-sunken px-4 py-3"
          >
            <p className="text-xs font-medium text-teal">
              {ko.settings.inviteUrl}
            </p>
            <p className="mt-1 font-pixel text-[16px] font-bold text-ink">
              {created.code}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="break-all rounded-sm bg-paper px-2 py-1 text-xs text-ink">
                {`${window.location.origin}${created.url}`}
              </code>
              <CopyInviteButton url={created.url} />
            </div>
          </div>
        ) : null}

        {invitesQuery.isPending ? (
          <p role="status" className="text-xs text-muted">
            {ko.common.loading}
          </p>
        ) : null}

        {invitesQuery.isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-xs text-brick">
              {ko.settings.invitesLoadFailed}
            </p>
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => void invitesQuery.refetch()}
            >
              {ko.common.retry}
            </Button>
          </div>
        ) : null}

        {!invitesQuery.isPending && !invitesQuery.isError ? (
          invites.length === 0 ? (
            <p className="text-xs text-muted">{ko.settings.inviteEmpty}</p>
          ) : (
            <ul className="space-y-2">
              {invites.map((invite) => {
                const active = invite.revokedAt === null;
                return (
                  <li
                    key={invite.id}
                    className="rounded-sm border border-line bg-paper px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon name="invite" size={32} />
                      <code className="rounded-sm bg-sunken px-1.5 py-0.5 font-pixel text-xs text-ink">
                        {invite.code}
                      </code>
                      <span
                        data-status={active ? "active" : "revoked"}
                        className="inline-flex items-center gap-1 text-xs text-muted"
                      >
                        <Icon
                          name={active ? "success" : "dropped"}
                          size={32}
                        />
                        {active ? ko.settings.active : ko.settings.revoked}
                      </span>
                      <span className="text-xs text-muted">
                        {ko.settings.createdBy(invite.createdBy.displayName)}
                      </span>
                      <time
                        className="text-xs text-muted"
                        dateTime={new Date(invite.createdAt).toISOString()}
                      >
                        {ko.time.relative(invite.createdAt)}
                      </time>
                    </div>

                    <p className="mt-1 break-all text-xs text-muted">
                      {`${window.location.origin}${invite.url}`}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {active ? (
                        <>
                          <CopyInviteButton url={invite.url} />
                          <Button
                            variant="danger"
                            icon="dropped"
                            onClick={() => handleRevoke(invite.id)}
                            disabled={revokingId === invite.id}
                          >
                            {revokingId === invite.id
                              ? ko.settings.revokingInvite
                              : ko.settings.revokeInvite}
                          </Button>
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
    </Panel>
  );
}

export default InviteSection;
