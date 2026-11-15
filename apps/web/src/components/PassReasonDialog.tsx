/**
 * "Pass this nomination" dialog (패스 / 토스).
 *
 * Opened from the notification bell and reused by the quest drawer (T08).
 * The reason is optional: a preset chip or up to 100 custom characters. The
 * adventurer may also toss the nomination to another guild member, excluding
 * the caller (`excludeUserIds`) and themselves.
 *
 * Submitting calls `POST /api/nominations/:id/pass`; the returned quest seeds
 * the detail cache and the board/detail/event/nomination/notification queries
 * are invalidated before the dialog closes.
 */
import {
  PASS_REASON_PRESETS,
  type PassNominationRequest,
  type Quest,
} from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { fetchMe } from "../api/auth";
import { pass } from "../api/party";
import { fetchProject } from "../api/projects";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";
import { applyQuestUpdate } from "./quest/partyCache";
import { partyErrorMessage } from "./quest/partyError";
import { Button, TextInput } from "./ui";

/** Custom pass-reason limit enforced by the server contract. */
export const MAX_PASS_REASON_LENGTH = 100;

/** Props for {@link PassReasonDialog}. */
export interface PassReasonDialogProps {
  /** Nomination being passed. */
  nominationId: number;
  /** Guild the nomination belongs to (used for the toss member list). */
  projectId: number;
  /** Members that must not be offered as toss targets (e.g. the nominator). */
  excludeUserIds?: number[];
  /** Close the dialog without submitting. */
  onClose: () => void;
  /** Called with the updated quest after a successful pass, before closing. */
  onPassed?: (quest: Quest) => void;
}

/** Preset-or-custom pass reason plus an optional toss recipient. */
export function PassReasonDialog({
  nominationId,
  projectId,
  excludeUserIds,
  onClose,
  onPassed,
}: PassReasonDialogProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const descriptionId = useId();
  const reasonInputId = useId();
  const tossSelectId = useId();

  const [reason, setReason] = useState("");
  const [relayToUserId, setRelayToUserId] = useState("");

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: ({ signal }) => fetchProject(projectId, signal),
    retry: false,
  });

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        // Capture phase: dismiss only this dialog, not a surrounding drawer.
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const passMutation = useMutation({
    mutationFn: (body: PassNominationRequest) => pass(nominationId, body),
    onSuccess: async (updated) => {
      // The pass answers with the quest detail (AUTO transitions included), so
      // seed that cache first and let the shared helper refresh the board,
      // detail, events, my-nominations and notification queries.
      applyQuestUpdate(queryClient, projectId, updated);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project(projectId),
      });
      onPassed?.(updated);
      onClose();
    },
  });

  const excluded = new Set(excludeUserIds ?? []);
  const meId = meQuery.data?.user.id ?? null;
  // Self can only be filtered out once the current adventurer is known. Until
  // then (pending or failed /api/auth/me) the toss select stays empty and
  // disabled so the caller can never be offered as a toss target.
  const canToss = meId !== null;
  const candidates = canToss
    ? (projectQuery.data?.members ?? [])
        .filter(
          (member) => member.userId !== meId && !excluded.has(member.userId),
        )
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName, "ko"),
        )
    : [];

  const trimmedReason = reason.trim();

  const handlePreset = (preset: string): void => {
    setReason((current) => (current === preset ? "" : preset));
  };

  const handleSubmit = () => {
    if (passMutation.isPending) {
      return;
    }

    const body: PassNominationRequest = {};
    if (trimmedReason.length > 0) {
      body.reason = trimmedReason;
    }
    if (relayToUserId !== "") {
      body.relayToUserId = Number(relayToUserId);
    }
    passMutation.mutate(body);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-sm border-[1.5px] border-line-strong bg-paper p-5 shadow-hard"
      >
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {ko.pass.title}
        </h2>
        <p id={descriptionId} className="mt-1 text-xs text-muted">
          {ko.pass.description}
        </p>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-ink">
              {ko.pass.presetsLabel}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PASS_REASON_PRESETS.map((preset) => {
                const selected = trimmedReason === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handlePreset(preset)}
                    className={[
                      "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs transition-colors",
                      selected
                        ? "border-line-strong bg-sunken text-ink"
                        : "border-line text-muted hover:bg-sunken hover:text-ink",
                    ].join(" ")}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={reasonInputId}
              className="block text-xs font-medium text-ink"
            >
              {ko.pass.reasonLabel}
            </label>
            <TextInput
              id={reasonInputId}
              value={reason}
              maxLength={MAX_PASS_REASON_LENGTH}
              placeholder={ko.pass.reasonPlaceholder}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={tossSelectId}
              className="block text-xs font-medium text-ink"
            >
              {ko.pass.tossLabel}
            </label>
            <select
              id={tossSelectId}
              value={relayToUserId}
              disabled={!canToss || projectQuery.isPending}
              onChange={(event) => setRelayToUserId(event.target.value)}
              className="w-full rounded-sm border-[1.5px] border-line-strong bg-paper px-2.5 py-1.5 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">{ko.pass.tossNone}</option>
              {candidates.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
            {projectQuery.isError || meQuery.isError ? (
              <p role="alert" className="text-xs text-brick">
                {ko.pass.membersLoadFailed}
              </p>
            ) : null}
          </div>

          {passMutation.isError ? (
            <p role="alert" className="text-xs text-brick">
              {partyErrorMessage(passMutation.error, ko.pass.failed)}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {ko.common.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={passMutation.isPending}
          >
            {passMutation.isPending ? ko.pass.submitting : ko.pass.submit}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default PassReasonDialog;
