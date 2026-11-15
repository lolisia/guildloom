/**
 * Party (파티) section of the quest drawer.
 *
 * Rendered between the dungeon view and the title, it shows the active party
 * (avatar, name, leader marker and clear-status chip), the dimmed collapsed
 * list of retreated adventurers and every pending nomination. Below those
 * lists sit the situation-specific actions:
 *
 * - a pending nomination addressed to the signed-in adventurer → 수락 / 패스
 *   (the shared {@link PassReasonDialog} handles the optional toss);
 * - a non-member → 참여;
 * - an active member → 합류 / 전투중 / 전투 완료 toggles and 후퇴 with an
 *   optional reason.
 *
 * The header also carries the 지목 (non-members) or 증원 요청 (members) popover.
 * Every mutation seeds the detail cache from the returned quest and invalidates
 * the board, detail, events, my-nominations and notification queries; 403/409
 * failures surface as Korean alert copy.
 */
import {
  ACTIVE_MEMBER_STATUSES,
  MEMBER_STATUS_LABELS,
  type ActiveMemberStatus,
  type MemberStatus,
  type Nomination,
  type PartyMember,
  type Quest,
} from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { fetchMe } from "../../api/auth";
import {
  accept,
  cancel as cancelNomination,
  join,
  leave,
  status as setMemberStatus,
} from "../../api/party";
import { ko } from "../../i18n/ko";
import { PARTY_STATUS_ICON } from "../../lib/icons";
import { queryKeys } from "../../lib/queryKeys";
import AdventurerSprite from "../AdventurerSprite";
import Icon from "../Icon";
import PassReasonDialog from "../PassReasonDialog";
import { Button, TextInput } from "../ui";
import NominationPopover from "./NominationPopover";
import { applyQuestUpdate, invalidatePartyQueries } from "./partyCache";
import { partyErrorMessage } from "./partyError";

/** Maximum retreat reason length enforced by the server contract. */
const MAX_REASON_LENGTH = 100;

/** Props for {@link PartySection}. */
export interface PartySectionProps {
  projectId: number;
  quest: Quest;
}

/** Status icon plus Korean label for one party member. */
function MemberStatusChip({ status }: { status: MemberStatus }) {
  return (
    <span
      data-party-status-chip={status}
      aria-label={`${ko.party.statusChip} ${MEMBER_STATUS_LABELS[status]}`}
      className="inline-flex items-center gap-1 rounded-sm border border-line px-1 text-xs text-muted"
    >
      <Icon name={PARTY_STATUS_ICON[status]} size={32} />
      <span>{MEMBER_STATUS_LABELS[status]}</span>
    </span>
  );
}

/** Optional-reason dialog shown before retreating (후퇴). */
function LeaveReasonDialog({
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const [reason, setReason] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      // Capture phase: dismiss only this dialog, not the quest drawer behind it.
      event.stopPropagation();
      if (!isPending) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isPending, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-sm rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
      >
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {ko.party.leaveTitle}
        </h2>
        <p id={descriptionId} className="mt-1 text-xs text-muted">
          {ko.party.leaveDescription}
        </p>

        <div className="mt-4 space-y-1.5">
          <label
            htmlFor={reasonId}
            className="block text-xs font-medium text-ink"
          >
            {ko.party.leaveReasonLabel}
          </label>
          <TextInput
            id={reasonId}
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            placeholder={ko.party.leaveReasonPlaceholder}
            onChange={(event) => setReason(event.target.value)}
            autoFocus
          />
        </div>

        {error ? (
          <p role="alert" className="mt-2 text-xs text-brick">
            {partyErrorMessage(error)}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {ko.common.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={() => onSubmit(reason)}
            disabled={isPending}
          >
            {isPending ? ko.party.leaving : ko.party.leaveConfirm}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Party status, nominations and membership actions for one quest. */
export function PartySection({ projectId, quest }: PartySectionProps) {
  const queryClient = useQueryClient();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [passTarget, setPassTarget] = useState<Nomination | null>(null);

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
  });
  const meId = meQuery.data?.user.id ?? null;

  const activeMembers: PartyMember[] = quest.party.filter(
    (member) => member.status !== "retreated",
  );
  const retreatedMembers: PartyMember[] = quest.party.filter(
    (member) => member.status === "retreated",
  );
  const activeUserIds = activeMembers.map((member) => member.user.id);
  const myMember =
    meId === null
      ? undefined
      : activeMembers.find((member) => member.user.id === meId);
  const nominations = quest.nominations.filter(
    (nomination) => nomination.state === "pending",
  );
  const myPendingNomination =
    meId === null
      ? undefined
      : nominations.find((nomination) => nomination.nominee.id === meId);

  const acceptMutation = useMutation({
    mutationFn: (nominationId: number) => accept(nominationId),
    onSuccess: (updated) => applyQuestUpdate(queryClient, projectId, updated),
  });

  const joinMutation = useMutation({
    mutationFn: () => join(quest.id),
    onSuccess: (updated) => applyQuestUpdate(queryClient, projectId, updated),
  });

  const statusMutation = useMutation({
    mutationFn: (next: ActiveMemberStatus) =>
      setMemberStatus(quest.id, { status: next }),
    onSuccess: (updated) => applyQuestUpdate(queryClient, projectId, updated),
  });

  const leaveMutation = useMutation({
    mutationFn: (reason: string) => {
      const trimmed = reason.trim();
      return leave(quest.id, trimmed.length > 0 ? { reason: trimmed } : {});
    },
    onSuccess: (updated) => {
      setLeaveOpen(false);
      applyQuestUpdate(queryClient, projectId, updated);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (nominationId: number) => cancelNomination(nominationId),
    onSuccess: (_data, nominationId) => {
      const key = queryKeys.quest(quest.id);
      const cached = queryClient.getQueryData<Quest>(key);
      if (cached) {
        const remaining = cached.nominations.filter(
          (nomination) => nomination.id !== nominationId,
        );
        queryClient.setQueryData<Quest>(key, {
          ...cached,
          nominations: remaining,
          pendingNominations: remaining.length,
        });
      }
      invalidatePartyQueries(queryClient, projectId, quest.id);
    },
  });

  /** Merge the nominations returned by 지목/증원 요청 into the detail cache. */
  const handleNominationsCreated = (created: Nomination[]): void => {
    const key = queryKeys.quest(quest.id);
    const cached = queryClient.getQueryData<Quest>(key);
    if (cached) {
      const known = new Set(cached.nominations.map((nomination) => nomination.id));
      const merged = [
        ...cached.nominations,
        ...created.filter((nomination) => !known.has(nomination.id)),
      ];
      queryClient.setQueryData<Quest>(key, {
        ...cached,
        nominations: merged,
        pendingNominations: merged.length,
      });
    }
    invalidatePartyQueries(queryClient, projectId, quest.id);
  };

  const actionError =
    acceptMutation.error ??
    joinMutation.error ??
    statusMutation.error ??
    cancelMutation.error ??
    leaveMutation.error;

  return (
    <section
      aria-label={ko.party.title}
      data-testid="party-section"
      className="space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted">{ko.party.title}</h3>
        {meId !== null ? (
          <NominationPopover
            projectId={projectId}
            questId={quest.id}
            kind={myMember ? "reinforce" : "nominate"}
            activeUserIds={activeUserIds}
            onCreated={handleNominationsCreated}
          />
        ) : null}
      </div>

      {activeMembers.length === 0 ? (
        <p className="text-xs text-muted">{ko.party.empty}</p>
      ) : (
        <ul aria-label={ko.party.activeList} className="space-y-1.5">
          {activeMembers.map((member) => (
            <li
              key={member.user.id}
              data-party-user-id={member.user.id}
              data-party-role={member.role}
              data-party-status={member.status}
              className="flex flex-wrap items-center gap-2"
            >
              <AdventurerSprite
                userId={member.user.id}
                displayName={member.user.displayName}
                size="sm"
              />
              <span className="text-sm font-medium text-ink">
                {member.user.displayName}
              </span>
              {member.role === "leader" ? (
                <span
                  data-party-leader="true"
                  className="inline-flex items-center gap-0.5 text-[12px] font-medium text-ink"
                >
                  <Icon name="party" size={32} />
                  {ko.quest.partyLeader}
                </span>
              ) : null}
              <MemberStatusChip status={member.status} />
            </li>
          ))}
        </ul>
      )}

      {retreatedMembers.length > 0 ? (
        <details
          data-testid="retreated-list"
          data-retreated-count={retreatedMembers.length}
          className="rounded-sm border border-line px-2 py-1.5 opacity-60"
        >
          <summary className="flex cursor-pointer select-none items-center gap-1 text-xs text-muted">
            <span>{ko.party.retreated}</span>
            <span className="font-pixel text-[12px] text-ink">
              {retreatedMembers.length}
            </span>
          </summary>
          <ul className="mt-1 space-y-1">
            {retreatedMembers.map((member) => (
              <li
                key={member.user.id}
                data-retreated-user-id={member.user.id}
                className="flex flex-wrap items-center gap-2 text-xs text-muted"
              >
                <AdventurerSprite
                  userId={member.user.id}
                  displayName={member.user.displayName}
                  size="sm"
                />
                <span className="text-ink">{member.user.displayName}</span>
                <span>{MEMBER_STATUS_LABELS.retreated}</span>
                <span>
                  {member.retreatReason
                    ? ko.party.retreatReason(member.retreatReason)
                    : ko.party.noRetreatReason}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {nominations.length > 0 ? (
        <ul aria-label={ko.party.nominationList} className="space-y-1">
          {nominations.map((nomination) => {
            const canCancel =
              meId !== null &&
              (nomination.nominee.id === meId ||
                nomination.nominatedBy.id === meId);
            return (
              <li
                key={nomination.id}
                data-nomination-id={nomination.id}
                className="flex items-center justify-between gap-2 rounded-sm border border-line px-2 py-1"
              >
                <span className="min-w-0 truncate text-xs">
                  <span className="font-medium text-ink">
                    {ko.party.nominationLabel}: {nomination.nominee.displayName}
                  </span>
                  <span className="ml-1 text-muted">
                    {ko.party.nominatedBy(
                      nomination.nominatedBy.displayName,
                    )}
                  </span>
                </span>
                {canCancel ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={ko.party.cancelNomination}
                    onClick={() => cancelMutation.mutate(nomination.id)}
                    disabled={cancelMutation.isPending}
                  >
                    ×
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {meId !== null ? (
        <div
          data-testid="party-actions"
          className="flex flex-wrap items-center gap-1.5"
        >
          {myPendingNomination ? (
            <>
              <Button
                variant="primary"
                icon="accept"
                disabled={acceptMutation.isPending}
                onClick={() => acceptMutation.mutate(myPendingNomination.id)}
              >
                {acceptMutation.isPending
                  ? ko.party.accepting
                  : ko.party.accept}
              </Button>
              <Button
                icon="pass"
                onClick={() => setPassTarget(myPendingNomination)}
              >
                {ko.party.pass}
              </Button>
            </>
          ) : myMember ? (
            <>
              {ACTIVE_MEMBER_STATUSES.map((status) => {
                const current = myMember.status === status;
                return (
                  <Button
                    key={status}
                    variant={current ? "primary" : "secondary"}
                    aria-pressed={current}
                    data-member-status={status}
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate(status)}
                  >
                    {MEMBER_STATUS_LABELS[status]}
                  </Button>
                );
              })}
              <Button
                variant="danger"
                icon="retreated"
                disabled={leaveMutation.isPending}
                onClick={() => {
                  leaveMutation.reset();
                  setLeaveOpen(true);
                }}
              >
                {ko.party.leave}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              icon="accept"
              disabled={joinMutation.isPending}
              onClick={() => joinMutation.mutate()}
            >
              {joinMutation.isPending ? ko.party.joining : ko.party.join}
            </Button>
          )}
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-xs text-brick">
          {partyErrorMessage(actionError)}
        </p>
      ) : null}

      {passTarget ? (
        <PassReasonDialog
          nominationId={passTarget.id}
          projectId={projectId}
          excludeUserIds={activeUserIds}
          onClose={() => setPassTarget(null)}
          onPassed={(updated) =>
            applyQuestUpdate(queryClient, projectId, updated)
          }
        />
      ) : null}

      {leaveOpen ? (
        <LeaveReasonDialog
          isPending={leaveMutation.isPending}
          error={leaveMutation.error}
          onClose={() => setLeaveOpen(false)}
          onSubmit={(reason) => leaveMutation.mutate(reason)}
        />
      ) : null}
    </section>
  );
}

export default PartySection;
