/**
 * Floors (던전 층) section of the quest drawer.
 *
 * The checklist sits between the direction field and the adventure log. Every
 * floor can be checked/unchecked, renamed inline, dragged into a new order with
 * `dnd-kit` (with arrow buttons as the keyboard-accessible fallback) or
 * deleted, and the bottom row appends new floors on Enter or from a multi-line
 * paste.
 *
 * All mutations call the documented endpoints, seed the detail cache with the
 * server response and invalidate the quest detail, the adventure log and the
 * `["quests", projectId]` prefix so board/ledger cards follow.
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Floor, Quest, UpdateFloorRequest } from "@guildloom/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties, ClipboardEvent, KeyboardEvent } from "react";
import { useEffect, useState } from "react";

import {
  addFloors,
  deleteFloor,
  moveFloor,
  updateFloor,
} from "../../api/floors";
import { ko } from "../../i18n/ko";
import { isImeComposing } from "../../lib/ime";
import { queryKeys } from "../../lib/queryKeys";
import Icon from "../Icon";
import { Button, TextInput } from "../ui";
import {
  applyFloorDelete,
  applyFloorUpdate,
  invalidateFloorQueries,
  setQuestFloors,
} from "./floorCache";
import { planFloorMove, type FloorMovePlan } from "./floorMove";

/** Maximum number of floors the add endpoint accepts in one call. */
const MAX_ADD_FLOORS = 50;

/** Maximum floor title length enforced by the shared contract. */
const MAX_FLOOR_TITLE_LENGTH = 200;

/** Split typed or pasted text into one trimmed title per line. */
export function splitFloorTitles(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((title) => title.trim().slice(0, MAX_FLOOR_TITLE_LENGTH))
    .filter((title) => title.length > 0)
    .slice(0, MAX_ADD_FLOORS);
}

/** Props for {@link QuestFloors}. */
export interface QuestFloorsProps {
  projectId: number;
  quest: Quest;
}

interface UpdateFloorVariables {
  floorId: number;
  body: UpdateFloorRequest;
}

interface MoveFloorContext {
  previousFloors: Floor[] | undefined;
}

/** One sortable floor row: drag handle, checkbox, inline title and controls. */
function FloorRow({
  floor,
  index,
  total,
  disabled,
  onToggle,
  onRename,
  onDelete,
  onMove,
}: {
  floor: Floor;
  index: number;
  total: number;
  disabled: boolean;
  onToggle: (floorId: number, done: boolean) => void;
  onRename: (floorId: number, title: string) => void;
  onDelete: (floorId: number) => void;
  onMove: (floorId: number, direction: -1 | 1) => void;
}) {
  const [draft, setDraft] = useState(floor.title);

  useEffect(() => {
    setDraft(floor.title);
  }, [floor.title]);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: floor.id });

  const dragTransform = CSS.Transform.toString(transform);
  const style: CSSProperties = {
    transition: isDragging ? undefined : transition,
  };
  if (dragTransform) {
    style.transform = dragTransform;
  }
  if (isDragging) {
    // DESIGN.md: only the row being dragged lifts off the paper.
    style.transform = dragTransform
      ? `${dragTransform} translate(-2px, -2px)`
      : "translate(-2px, -2px)";
    style.boxShadow = "4px 4px 0 var(--color-ink)";
    style.zIndex = 10;
  }

  const done = floor.doneAt !== null;

  const commitTitle = (): void => {
    const next = draft.trim();
    if (next.length === 0) {
      setDraft(floor.title);
      return;
    }
    if (next !== floor.title) {
      onRename(floor.id, next);
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-floor-id={floor.id}
      data-floor-done={done ? "true" : "false"}
      className={`flex items-start gap-1.5 rounded-sm border border-line bg-paper px-1.5 py-1 ${
        isDragging ? "relative cursor-grabbing" : ""
      }`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={ko.board.drawer.floors.drag(floor.title)}
        className="mt-0.5 cursor-grab touch-none select-none rounded-sm px-1 text-sm text-muted transition-colors hover:bg-sunken"
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">≡</span>
      </button>

      <input
        type="checkbox"
        aria-label={ko.board.drawer.floors.check(floor.title)}
        checked={done}
        disabled={disabled}
        onChange={(event) => onToggle(floor.id, event.target.checked)}
        className="mt-2 h-4 w-4 shrink-0 accent-teal"
      />

      <TextInput
        value={draft}
        aria-label={ko.board.drawer.floors.titleLabel(floor.title)}
        maxLength={MAX_FLOOR_TITLE_LENGTH}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== "Enter") {
            return;
          }
          event.preventDefault();
          if (isImeComposing(event)) {
            return;
          }
          commitTitle();
        }}
        className={`min-w-0 flex-1 ${done ? "text-muted line-through" : ""}`}
      />

      <div className="flex shrink-0 flex-col">
        <Button
          size="sm"
          variant="ghost"
          aria-label={ko.board.drawer.floors.moveUp(floor.title)}
          disabled={disabled || index === 0}
          onClick={() => onMove(floor.id, -1)}
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={ko.board.drawer.floors.moveDown(floor.title)}
          disabled={disabled || index === total - 1}
          onClick={() => onMove(floor.id, 1)}
        >
          ↓
        </Button>
      </div>

      <button
        type="button"
        aria-label={ko.board.drawer.floors.delete(floor.title)}
        disabled={disabled}
        onClick={() => onDelete(floor.id)}
        className="mt-0.5 rounded-sm px-1.5 py-0.5 text-sm text-muted transition-colors hover:bg-sunken hover:text-brick disabled:cursor-not-allowed disabled:opacity-50"
      >
        ×
      </button>
    </li>
  );
}

/** Dungeon floor checklist for one quest. */
export function QuestFloors({ projectId, quest }: QuestFloorsProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const refresh = (): void => {
    invalidateFloorQueries(queryClient, projectId, quest.id);
  };

  const addMutation = useMutation({
    mutationFn: (titles: string[]) => addFloors(quest.id, { titles }),
    onSuccess: (floors) => {
      setQuestFloors(queryClient, quest.id, floors);
      refresh();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (variables: UpdateFloorVariables) =>
      updateFloor(variables.floorId, variables.body),
    onSuccess: (updated) => {
      applyFloorUpdate(queryClient, projectId, quest.id, updated);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (floorId: number) => deleteFloor(floorId),
    onSuccess: (_data, floorId) => {
      applyFloorDelete(queryClient, projectId, quest.id, floorId);
    },
  });

  const moveMutation = useMutation<
    Floor,
    Error,
    FloorMovePlan,
    MoveFloorContext
  >({
    mutationFn: (plan) =>
      moveFloor(plan.floorId, {
        beforeId: plan.beforeId,
        afterId: plan.afterId,
      }),
    onMutate: async (plan) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.quest(quest.id),
      });
      const previous = queryClient.getQueryData<Quest>(
        queryKeys.quest(quest.id),
      );
      setQuestFloors(queryClient, quest.id, plan.floors);
      return { previousFloors: previous?.floors };
    },
    onError: (_error, _plan, context) => {
      if (context?.previousFloors) {
        setQuestFloors(queryClient, quest.id, context.previousFloors);
      }
      refresh();
    },
    onSuccess: (updated) => {
      applyFloorUpdate(queryClient, projectId, quest.id, updated);
    },
  });

  const floors = quest.floors;
  const doneCount = floors.filter((floor) => floor.doneAt !== null).length;
  const anyPending =
    addMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    moveMutation.isPending;

  const submitDraft = (): void => {
    const titles = splitFloorTitles(draft);
    if (titles.length === 0) {
      return;
    }
    setDraft("");
    addMutation.mutate(titles);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const text = event.clipboardData?.getData("text") ?? "";
    if (!/[\r\n]/.test(text)) {
      return;
    }
    event.preventDefault();
    const titles = splitFloorTitles(text);
    if (titles.length === 0) {
      return;
    }
    setDraft("");
    addMutation.mutate(titles);
  };

  const updateFloorById = (floorId: number, body: UpdateFloorRequest): void => {
    updateMutation.mutate({ floorId, body });
  };

  const moveToIndex = (floorId: number, direction: -1 | 1): void => {
    const index = floors.findIndex((floor) => floor.id === floorId);
    const target = floors[index + direction];
    if (index < 0 || !target) {
      return;
    }
    const plan = planFloorMove(floors, floorId, target.id);
    if (plan) {
      moveMutation.mutate(plan);
    }
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (over === null) {
      return;
    }
    const plan = planFloorMove(floors, Number(active.id), Number(over.id));
    if (plan) {
      moveMutation.mutate(plan);
    }
  };

  const errorMessage = addMutation.error
    ? ko.board.drawer.floors.addFailed
    : updateMutation.error
      ? ko.board.drawer.floors.saveFailed
      : deleteMutation.error
        ? ko.board.drawer.floors.deleteFailed
        : moveMutation.error
          ? ko.board.drawer.floors.moveFailed
          : null;

  return (
    <section
      aria-label={ko.board.drawer.floors.title}
      data-testid="quest-floors"
      className="space-y-2"
    >
      <div className="flex items-center gap-1.5">
        <Icon name="floor" size={32} />
        <h3 className="text-sm font-medium text-muted">
          {ko.board.drawer.floors.title}
        </h3>
        <span className="font-pixel text-[12px] text-ink">
          {ko.board.drawer.floorRatio(doneCount, floors.length)}
        </span>
      </div>

      {floors.length === 0 ? (
        <p className="text-xs text-muted">{ko.board.drawer.floors.empty}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={floors.map((floor) => floor.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              aria-label={ko.board.drawer.floors.title}
              className="space-y-1.5"
            >
              {floors.map((floor, index) => (
                <FloorRow
                  key={floor.id}
                  floor={floor}
                  index={index}
                  total={floors.length}
                  disabled={anyPending}
                  onToggle={(floorId, done) =>
                    updateFloorById(floorId, { done })
                  }
                  onRename={(floorId, title) =>
                    updateFloorById(floorId, { title })
                  }
                  onDelete={(floorId) => deleteMutation.mutate(floorId)}
                  onMove={moveToIndex}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex items-center gap-1.5">
        <TextInput
          value={draft}
          aria-label={ko.board.drawer.floors.add}
          placeholder={ko.board.drawer.floors.addPlaceholder}
          disabled={addMutation.isPending}
          maxLength={MAX_FLOOR_TITLE_LENGTH * MAX_ADD_FLOORS}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            if (isImeComposing(event)) {
              return;
            }
            submitDraft();
          }}
        />
        <Button
          variant="secondary"
          disabled={addMutation.isPending || splitFloorTitles(draft).length === 0}
          onClick={submitDraft}
          className="shrink-0"
        >
          {addMutation.isPending
            ? ko.board.drawer.floors.adding
            : ko.board.drawer.floors.add}
        </Button>
      </div>

      {errorMessage ? (
        <p role="alert" className="text-xs text-brick">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}

export default QuestFloors;
