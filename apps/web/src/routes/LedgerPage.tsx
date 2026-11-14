/**
 * The quest ledger ("의뢰 원장"): every quest as a sortable table.
 *
 * Filters (text, multi-select stage, tag) are sent to the list endpoint; the
 * eight columns sort client-side on header clicks. Clicking a row opens the
 * same `?quest=<id>` drawer as the board.
 */
import {
  RANKS,
  STAGES,
  type ListQuestsQuery,
  type QuestSummary,
  type Rank,
  type Stage,
} from "@guildloom/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useId, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { fetchQuests, fetchTags } from "../api/quests";
import AdventurerSprite from "../components/AdventurerSprite";
import QuestDrawer from "../components/quest/QuestDrawer";
import { ko } from "../i18n/ko";
import { formatKoreanDate } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";

/** The eight ledger columns, in display order. */
const LEDGER_COLUMNS = [
  "number",
  "title",
  "tags",
  "stage",
  "rank",
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

function compareRank(left: Rank | null, right: Rank | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return RANKS.indexOf(left) - RANKS.indexOf(right);
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
    case "tags":
      return left.tags.join(", ").localeCompare(right.tags.join(", "), "ko");
    case "stage":
      return stageOrder(left.stage) - stageOrder(right.stage);
    case "rank":
      return compareRank(left.rank, right.rank);
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
        <p role="alert" className="text-sm text-rose-300">
          {ko.errors.notFound}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">{ko.ledger.title}</h1>
        <p className="text-sm text-slate-400">{ko.ledger.description}</p>
        <p className="text-[11px] text-slate-500">{ko.ledger.sortHint}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="min-w-48 space-y-1">
          <label
            htmlFor={searchInputId}
            className="block text-[11px] font-semibold text-slate-400"
          >
            {ko.common.search}
          </label>
          <input
            id={searchInputId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={ko.common.search}
            placeholder={ko.board.searchPlaceholder}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/70"
          />
        </div>

        <fieldset className="space-y-1">
          <legend className="text-[11px] font-semibold text-slate-400">
            {ko.quest.stage}
          </legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {STAGES.map((stage) => (
              <label
                key={stage}
                className="inline-flex items-center gap-1 text-xs text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={selectedStages.includes(stage)}
                  onChange={() => toggleStage(stage)}
                  aria-label={ko.quest.stages[stage]}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 accent-emerald-500"
                />
                {ko.quest.stages[stage]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="min-w-40 space-y-1">
          <label
            htmlFor={tagSelectId}
            className="block text-[11px] font-semibold text-slate-400"
          >
            {ko.board.filterByTag}
          </label>
          <select
            id={tagSelectId}
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            aria-label={ko.board.filterByTag}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500/70"
          >
            <option value="">{ko.board.allTags}</option>
            {(tagsQuery.data ?? []).map((tagSummary) => (
              <option key={tagSummary.id} value={tagSummary.name}>
                {tagSummary.name} ({tagSummary.count})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={resetFilters}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          {ko.board.clearFilters}
        </button>
      </div>

      {questsQuery.isError ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-xs text-rose-300">
            {ko.ledger.loadFailed}
          </p>
          <button
            type="button"
            onClick={() => void questsQuery.refetch()}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
          >
            {ko.common.retry}
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{ko.ledger.title}</caption>
          <thead>
            <tr className="bg-slate-900/80">
              {LEDGER_COLUMNS.map((column) => {
                const active = sort?.column === column;
                const ariaSort = !active
                  ? "none"
                  : sort.direction === "asc"
                    ? "ascending"
                    : "descending";
                return (
                  <th
                    key={column}
                    scope="col"
                    aria-sort={ariaSort}
                    className="whitespace-nowrap border-b border-slate-800 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      aria-label={ko.ledger.sortBy(ko.ledger.columns[column])}
                      className="flex w-full items-center gap-1 rounded px-0.5 text-left hover:text-slate-200"
                    >
                      {ko.ledger.columns[column]}
                      <span aria-hidden="true" className="text-[9px] text-emerald-300">
                        {active ? (sort.direction === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {questsQuery.isPending && selectedStages.length > 0 ? (
              <tr>
                <td colSpan={LEDGER_COLUMNS.length} className="px-3 py-4 text-xs text-slate-500">
                  {ko.ledger.loading}
                </td>
              </tr>
            ) : null}

            {sortedQuests.length === 0 &&
            (selectedStages.length === 0 ||
              (!questsQuery.isPending && !questsQuery.isError)) ? (
              <tr>
                <td colSpan={LEDGER_COLUMNS.length} className="px-3 py-4 text-xs text-slate-500">
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
                  if (event.key === "Enter") {
                    event.preventDefault();
                    openQuest(quest.id);
                  }
                }}
                className="cursor-pointer border-b border-slate-800/60 bg-slate-950/30 align-middle hover:bg-slate-900/70 focus-visible:bg-slate-900/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
              >
                <td className="whitespace-nowrap px-2 py-2 text-xs font-bold text-slate-400">
                  {quest.number}
                </td>
                <td className="max-w-64 px-2 py-2 text-sm font-medium text-slate-100">
                  <span className="block truncate" title={quest.title}>
                    {quest.title}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {quest.tags.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {quest.tags.map((questTag) => (
                        <span
                          key={questTag}
                          className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300"
                        >
                          {questTag}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      {ko.ledger.noTags}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-300">
                  {ko.quest.stages[quest.stage]}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs font-bold text-amber-300">
                  {quest.rank ?? ko.ledger.noRank}
                </td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2">
                    <AdventurerSprite
                      userId={quest.createdBy.id}
                      displayName={quest.createdBy.displayName}
                      size="sm"
                    />
                    <span className="max-w-32 truncate text-xs text-slate-300">
                      {quest.createdBy.displayName}
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-400">
                  {formatKoreanDate(quest.createdAt)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-400">
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
