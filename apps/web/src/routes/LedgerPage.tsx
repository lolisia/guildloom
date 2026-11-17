/**
 * The quest ledger ("의뢰 원장"): every quest as a sortable table.
 *
 * Filters (text, multi-select stage, tag) are sent to the list endpoint; the
 * eleven columns sort client-side on header clicks. The M2a columns (party,
 * bounty and floor progress) sit after tags, before the stage. Kind ("종류")
 * follows the title so a feature request is identifiable at a glance. Clicking
 * a row opens the same `?quest=<id>` drawer as the board.
 *
 * The table follows DESIGN.md: a paper panel holds the filters, the header row
 * sits on the sunken layer, rows are separated by a 1px line and darken to
 * sunken on hover. The ledger keeps text only — no icons in stage, kind or
 * sort cells.
 */
import {
  STAGES,
  type ListQuestsQuery,
  type QuestSummary,
  type Stage,
} from "@guildloom/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useId, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { fetchQuests, fetchTags } from "../api/quests";
import AdventurerSprite from "../components/AdventurerSprite";
import { formatBounty } from "../components/board/QuestCard";
import QuestDrawer from "../components/quest/QuestDrawer";
import { Button, Chip, Panel, TextInput } from "../components/ui";
import { ko } from "../i18n/ko";
import { formatKoreanDate } from "../lib/format";
import { isImeComposing } from "../lib/ime";
import { queryKeys } from "../lib/queryKeys";

/** The eleven ledger columns, in display order. */
const LEDGER_COLUMNS = [
  "number",
  "title",
  "kind",
  "tags",
  "party",
  "bounty",
  "floors",
  "stage",
  "createdBy",
  "createdAt",
  "updatedAt",
] as const;

type LedgerColumn = (typeof LEDGER_COLUMNS)[number];
type SortDirection = "asc" | "desc";

interface SortState {
  column: LedgerColumn;
  direction: SortDirection;
}

/** Parse a positive integer route/search value. */
function parsePositiveInt(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function stageOrder(stage: Stage): number {
  return STAGES.indexOf(stage);
}

/** Party member names in display order, used by the column and its sort. */
function partyLabel(quest: QuestSummary): string {
  return quest.party.map((member) => member.displayName).join(", ");
}

function compareQuests(
  left: QuestSummary,
  right: QuestSummary,
  column: LedgerColumn,
): number {
  switch (column) {
    case "number":
      return left.number - right.number;
    case "title":
      return left.title.localeCompare(right.title, "ko");
    case "kind":
      return ko.quest.kinds[left.kind ?? "fix"].localeCompare(
        ko.quest.kinds[right.kind ?? "fix"],
        "ko",
      );
    case "tags":
      return left.tags.join(", ").localeCompare(right.tags.join(", "), "ko");
    case "party":
      return partyLabel(left).localeCompare(partyLabel(right), "ko");
    case "bounty":
      return left.bounty.total - right.bounty.total;
    case "floors": {
      const byDone = left.floors.done - right.floors.done;
      return byDone !== 0 ? byDone : left.floors.total - right.floors.total;
    }
    case "stage":
      return stageOrder(left.stage) - stageOrder(right.stage);
    case "createdBy":
      return left.createdBy.displayName.localeCompare(
        right.createdBy.displayName,
        "ko",
      );
    case "createdAt":
      return left.createdAt - right.createdAt;
    case "updatedAt":
      return left.updatedAt - right.updatedAt;
  }
}

/** The quest ledger table. */
export default function LedgerPage() {
  const { projectId: projectIdParam } = useParams<{ projectId: string }>();
  const parsedProjectId = parsePositiveInt(projectIdParam);
  const projectId = parsedProjectId ?? 0;

  const [searchParams, setSearchParams] = useSearchParams();
  const openQuestId = parsePositiveInt(searchParams.get("quest"));

  const searchInputId = useId();
  const tagSelectId = useId();

  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [selectedStages, setSelectedStages] = useState<Stage[]>(() => [
    ...STAGES,
  ]);
  const [sort, setSort] = useState<SortState | null>(null);

  const filters = useMemo<ListQuestsQuery>(() => {
    const query: ListQuestsQuery = {
      stage: selectedStages.join(","),
    };
    if (tag.length > 0) {
      query.tag = tag;
    }
    const trimmedSearch = search.trim();
    if (trimmedSearch.length > 0) {
      query.q = trimmedSearch;
    }
    return query;
  }, [selectedStages, tag, search]);

  const questsQuery = useQuery({
    queryKey: queryKeys.quests(projectId, filters),
    queryFn: ({ signal }) => fetchQuests(projectId, filters, signal),
    enabled: parsedProjectId !== null && selectedStages.length > 0,
  });

  const tagsQuery = useQuery({
    queryKey: queryKeys.tags(projectId),
    queryFn: ({ signal }) => fetchTags(projectId, "", signal),
    enabled: parsedProjectId !== null,
  });

  const sortedQuests = useMemo(() => {
    const list = [...(questsQuery.data ?? [])];
    if (!sort) {
      return list;
    }
    const direction = sort.direction === "asc" ? 1 : -1;
    list.sort((left, right) => {
      const primary = compareQuests(left, right, sort.column);
      if (primary !== 0) {
        return primary * direction;
      }
      return (left.number - right.number) * direction;
    });
    return list;
  }, [questsQuery.data, sort]);

  const toggleStage = (stage: Stage) => {
    setSelectedStages((previous) => {
      const selected = new Set(previous);
      if (selected.has(stage)) {
        selected.delete(stage);
      } else {
        selected.add(stage);
      }
      return STAGES.filter((candidate) => selected.has(candidate));
    });
  };

  const toggleSort = (column: LedgerColumn) => {
    setSort((previous) =>
      previous?.column === column
        ? {
            column,
            direction: previous.direction === "asc" ? "desc" : "asc",
          }
        : { column, direction: "asc" },
    );
  };

  const resetFilters = () => {
    setSearch("");
    setTag("");
    setSelectedStages([...STAGES]);
  };

  const openQuest = useCallback(
    (questId: number) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set("quest", String(questId));
        return next;
      });
    },
    [setSearchParams],
  );

  const closeQuest = useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("quest");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  if (parsedProjectId === null) {
    return (
      <section className="space-y-2">
        <p role="alert" className="text-sm text-brick">
          {ko.errors.notFound}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink">{ko.ledger.title}</h1>
        <p className="text-sm text-muted">{ko.ledger.description}</p>
        <p className="text-xs text-muted">{ko.ledger.sortHint}</p>
      </header>

      <Panel className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 space-y-1">
          <label
            htmlFor={searchInputId}
            className="block text-xs font-medium text-muted"
          >
            {ko.common.search}
          </label>
          <TextInput
            id={searchInputId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={ko.common.search}
            placeholder={ko.board.searchPlaceholder}
          />
        </div>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted">
            {ko.quest.stage}
          </legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {STAGES.map((stage) => (
              <label
                key={stage}
                className="inline-flex items-center gap-1 text-xs text-ink"
              >
                <input
                  type="checkbox"
                  checked={selectedStages.includes(stage)}
                  onChange={() => toggleStage(stage)}
                  aria-label={ko.quest.stages[stage]}
                  className="h-4 w-4 rounded-sm border border-line-strong accent-teal"
                />
                {ko.quest.stages[stage]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="min-w-40 space-y-1">
          <label
            htmlFor={tagSelectId}
            className="block text-xs font-medium text-muted"
          >
            {ko.board.filterByTag}
          </label>
          <select
            id={tagSelectId}
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            aria-label={ko.board.filterByTag}
            className="h-8 w-full rounded-sm border-[1.5px] border-line-strong bg-paper px-2 text-sm text-ink"
          >
            <option value="">{ko.board.allTags}</option>
            {(tagsQuery.data ?? []).map((tagSummary) => (
              <option key={tagSummary.id} value={tagSummary.name}>
                {tagSummary.name} ({tagSummary.count})
              </option>
            ))}
          </select>
        </div>

        <Button variant="ghost" onClick={resetFilters}>
          {ko.board.clearFilters}
        </Button>
      </Panel>

      {questsQuery.isError ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-xs text-brick">
            {ko.ledger.loadFailed}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void questsQuery.refetch()}
          >
            {ko.common.retry}
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse bg-paper text-left text-sm">
          <caption className="sr-only">{ko.ledger.title}</caption>
          <thead className="bg-sunken">
            <tr>
              {LEDGER_COLUMNS.map((column) => {
                const active = sort?.column === column;
                const activeDirection = active ? sort?.direction : undefined;
                const ariaSort = !activeDirection
                  ? "none"
                  : activeDirection === "asc"
                    ? "ascending"
                    : "descending";
                return (
                  <th
                    key={column}
                    scope="col"
                    aria-sort={ariaSort}
                    className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      aria-label={ko.ledger.sortBy(ko.ledger.columns[column])}
                      className="inline-flex items-center gap-1 rounded-sm px-0.5 py-0.5 text-left font-pixel text-[12px] text-muted hover:text-ink"
                    >
                      {ko.ledger.columns[column]}
                      {activeDirection ? (
                        <span
                          aria-hidden="true"
                          className="font-pixel text-[12px]"
                        >
                          {activeDirection === "asc" ? "▲" : "▼"}
                        </span>
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {questsQuery.isPending && selectedStages.length > 0 ? (
              <tr>
                <td
                  colSpan={LEDGER_COLUMNS.length}
                  className="px-3 py-6 text-xs text-muted"
                >
                  {ko.ledger.loading}
                </td>
              </tr>
            ) : null}

            {sortedQuests.length === 0 &&
            (selectedStages.length === 0 ||
              (!questsQuery.isPending && !questsQuery.isError)) ? (
              <tr>
                <td
                  colSpan={LEDGER_COLUMNS.length}
                  className="px-3 py-6 text-xs text-muted"
                >
                  {ko.ledger.empty}
                </td>
              </tr>
            ) : null}

            {sortedQuests.map((quest) => (
              <tr
                key={quest.id}
                data-quest-id={quest.id}
                data-stage={quest.stage}
                tabIndex={0}
                onClick={() => openQuest(quest.id)}
                onKeyDown={(event) => {
                  // Ignore the Enter that confirms an IME candidate (Korean,
                  // Japanese, …): opening the drawer mid-composition loses the
                  // text the user is still typing.
                  if (event.key !== "Enter" || isImeComposing(event)) {
                    return;
                  }
                  event.preventDefault();
                  openQuest(quest.id);
                }}
                className="cursor-pointer border-b border-line align-middle transition-colors hover:bg-sunken focus-visible:bg-sunken"
              >
                <td className="whitespace-nowrap px-2 py-2 font-pixel text-[12px] text-muted">
                  #{quest.number}
                </td>
                <td className="max-w-64 px-2 py-2 text-sm font-medium text-ink">
                  <span className="block truncate" title={quest.title}>
                    {quest.title}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-ink">
                  {ko.quest.kinds[quest.kind ?? "fix"]}
                </td>
                <td className="px-2 py-2">
                  {quest.tags.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {quest.tags.map((questTag) => (
                        <Chip key={questTag}>{questTag}</Chip>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">
                      {ko.ledger.noTags}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {quest.party.length > 0 ? (
                    <span className="flex max-w-48 flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink">
                      {quest.party.map((member) => (
                        <span
                          key={member.userId}
                          data-party-role={member.role}
                          className="whitespace-nowrap"
                        >
                          {member.displayName}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">
                      {ko.quest.emptyParty}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 font-pixel text-[12px] text-gold">
                  {formatBounty(quest.bounty.total)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 font-pixel text-[12px] text-ink">
                  {quest.floors.done}/{quest.floors.total}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-ink">
                  {ko.quest.stages[quest.stage]}
                </td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2">
                    <AdventurerSprite
                      userId={quest.createdBy.id}
                      displayName={quest.createdBy.displayName}
                      size="sm"
                    />
                    <span className="max-w-32 truncate text-xs text-ink">
                      {quest.createdBy.displayName}
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">
                  {formatKoreanDate(quest.createdAt)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">
                  {formatKoreanDate(quest.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openQuestId !== null ? (
        <QuestDrawer
          projectId={projectId}
          questId={openQuestId}
          onClose={closeQuest}
        />
      ) : null}
    </section>
  );
}
