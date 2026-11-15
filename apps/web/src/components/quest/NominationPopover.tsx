/**
 * 지목 / 증원 요청 popover for the drawer's party section.
 *
 * Opening the trigger loads the guild roster (`GET /api/projects/:pid`) and
 * lists every member that is not already in the active party. Several members
 * may be checked at once; submitting posts the selected ids to
 * `POST /api/quests/:id/nominations` (non-members) or `.../reinforcements`
 * (active members). The created nominations are handed back to the party
 * section, which merges them into the quest cache.
 *
 * The panel follows DESIGN.md's popover rule: paper, 1.5px ink outline and one
 * `4px 4px 0 ink` hard shadow.
 */
import type { Nomination, ProjectMember } from "@guildloom/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";

import { nominate, reinforce } from "../../api/party";
import { fetchProject } from "../../api/projects";
import { ko } from "../../i18n/ko";
import { queryKeys } from "../../lib/queryKeys";
import AdventurerSprite from "../AdventurerSprite";
import { Button } from "../ui";
import { partyErrorMessage } from "./partyError";

/** Whether the popover nominates new adventurers or asks for reinforcements. */
export type NominationKind = "nominate" | "reinforce";

/** Props for {@link NominationPopover}. */
export interface NominationPopoverProps {
  projectId: number;
  questId: number;
  kind: NominationKind;
  /** Active party user ids, hidden from the candidate list. */
  activeUserIds: number[];
  /** Called with the nominations created by the request. */
  onCreated: (nominations: Nomination[]) => void;
}

/** Trigger, roster checklist and submit button for a nomination batch. */
export function NominationPopover({
  projectId,
  questId,
  kind,
  activeUserIds,
  onCreated,
}: NominationPopoverProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: ({ signal }) => fetchProject(projectId, signal),
    enabled: open,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (userIds: number[]) =>
      kind === "reinforce"
        ? reinforce(questId, { userIds })
        : nominate(questId, { userIds }),
    onSuccess: (data) => {
      onCreated(data.nominations);
      setOpen(false);
    },
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const container = containerRef.current;
      const target = event.target;
      if (
        container &&
        target instanceof Node &&
        !container.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        // Capture phase: close only this popover, not the surrounding drawer.
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const excluded = new Set(activeUserIds);
  const candidates = (projectQuery.data?.members ?? [])
    .filter((member) => !excluded.has(member.userId))
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "ko"),
    );

  const toggle = (userId: number): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const openPopover = (): void => {
    mutation.reset();
    setSelected(new Set());
    setOpen((current) => !current);
  };

  const submit = (): void => {
    if (selected.size === 0 || mutation.isPending) {
      return;
    }
    mutation.mutate([...selected]);
  };

  const isReinforce = kind === "reinforce";
  const triggerLabel = isReinforce ? ko.party.reinforce : ko.party.nominate;
  const title = isReinforce ? ko.party.reinforceTitle : ko.party.nominateTitle;
  const submitLabel = isReinforce
    ? ko.party.reinforceSubmit
    : ko.party.nominateSubmit;

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        size="md"
        variant="secondary"
        icon={isReinforce ? "reinforce" : "nominate"}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-party-nomination-trigger={kind}
        onClick={openPopover}
      >
        {triggerLabel}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="absolute right-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-sm border-[1.5px] border-line-strong bg-paper p-3 shadow-hard"
        >
          <p id={titleId} className="text-xs font-semibold text-ink">
            {title}
          </p>

          {projectQuery.isPending ? (
            <p role="status" className="mt-2 text-xs text-muted">
              {ko.common.loading}
            </p>
          ) : null}

          {projectQuery.isError ? (
            <p role="alert" className="mt-2 text-xs text-brick">
              {ko.party.membersLoadFailed}
            </p>
          ) : null}

          {!projectQuery.isPending &&
          !projectQuery.isError &&
          candidates.length === 0 ? (
            <p className="mt-2 text-xs text-muted">{ko.party.noCandidates}</p>
          ) : null}

          {candidates.length > 0 ? (
            <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
              {candidates.map((member: ProjectMember) => {
                const checked = selected.has(member.userId);
                return (
                  <li key={member.userId}>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={member.displayName}
                        onChange={() => toggle(member.userId)}
                        className="h-4 w-4 rounded-sm accent-teal"
                      />
                      <AdventurerSprite
                        userId={member.userId}
                        displayName={member.displayName}
                        size="sm"
                      />
                      <span className="min-w-0 truncate">
                        {member.displayName}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {mutation.isError ? (
            <p role="alert" className="mt-2 text-xs text-brick">
              {partyErrorMessage(mutation.error)}
            </p>
          ) : null}

          <div className="mt-3 flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {ko.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={submit}
              disabled={selected.size === 0 || mutation.isPending}
            >
              {mutation.isPending ? ko.party.submitting : submitLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NominationPopover;
