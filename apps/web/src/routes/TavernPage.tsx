/**
 * 주점 (tavern): the guild-wide chat room.
 *
 * The page is a fixed-height column under the 44px top bar: a pixel-font
 * title, the oldest-first transcript in a scrolling area and the composer.
 * History pages backwards from an explicit button. Sending, deleting and
 * promoting all invalidate the room plus the unread badges (promotion also
 * refreshes the quest board).
 *
 * `/의뢰 제목` on the first line (with the rest as the situation) posts a quest
 * instead of a message; a bare `/의뢰` explains the expected shape and keeps
 * the draft. Mention names come from the guild member list, which is the same
 * source as the composer's autocomplete.
 */
import type { ChatMessage, CreateQuestFromChatResponse } from "@guildloom/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { fetchMe } from "../api/auth";
import {
  createQuestFromTavernMessage,
  deleteChatMessage,
  fetchTavernMessages,
  postTavernMessage,
} from "../api/chat";
import { fetchProject } from "../api/projects";
import CreateQuestFromMessageDialog from "../components/chat/CreateQuestFromMessageDialog";
import MessageComposer from "../components/chat/MessageComposer";
import MessageList from "../components/chat/MessageList";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";
import { pushToast } from "../lib/toast";
import { useMarkRead } from "../lib/useMarkRead";

/** The `/의뢰` command keyword. */
const QUEST_COMMAND = "/의뢰";

/** `/의뢰` must be followed by whitespace/newline or the end of the draft. */
const QUEST_COMMAND_RE = /^\/의뢰(?=$|\s)/;

/** Parse a positive integer route parameter. */
function parseProjectId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** 주점 chat room. */
export default function TavernPage() {
  const { projectId: projectIdParam } = useParams<{ projectId: string }>();
  const parsedProjectId = parseProjectId(projectIdParam);
  const projectId = parsedProjectId ?? 0;
  const queryClient = useQueryClient();
  const [promoteTarget, setPromoteTarget] = useState<ChatMessage | null>(null);

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
    enabled: parsedProjectId !== null,
  });

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: ({ signal }) => fetchProject(projectId, signal),
    enabled: parsedProjectId !== null,
  });

  const members = useMemo(
    () =>
      (projectQuery.data?.members ?? []).map((member) => ({
        id: member.userId,
        displayName: member.displayName,
      })),
    [projectQuery.data],
  );

  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const member of projectQuery.data?.members ?? []) {
      map.set(member.userId, member.displayName);
    }
    return map;
  }, [projectQuery.data]);

  const resolveName = useCallback(
    (userId: number): string | null => nameById.get(userId) ?? null,
    [nameById],
  );

  const messagesQuery = useInfiniteQuery({
    queryKey: queryKeys.tavernMessages(projectId),
    queryFn: ({ pageParam, signal }) =>
      fetchTavernMessages(
        projectId,
        pageParam === undefined ? {} : { before: pageParam },
        signal,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.messages[0]?.id : undefined,
    enabled: parsedProjectId !== null,
  });

  // Pages arrive newest first; reverse them so every message is rendered
  // oldest-to-newest with the newest page at the bottom.
  const messages = useMemo(() => {
    const pages = messagesQuery.data?.pages ?? [];
    return pages
      .slice()
      .reverse()
      .flatMap((page) => page.messages);
  }, [messagesQuery.data]);

  const newestMessageId =
    messages.length > 0 ? messages[messages.length - 1]?.id : undefined;

  useMarkRead(projectId, null, newestMessageId);

  const invalidateRoom = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.tavernMessages(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.chatUnread(projectId),
        }),
      ]),
    [projectId, queryClient],
  );

  const sendMutation = useMutation({
    mutationFn: (body: string) => postTavernMessage(projectId, { body }),
    onSuccess: () => void invalidateRoom(),
  });

  const deleteMutation = useMutation({
    mutationFn: (messageId: number) => deleteChatMessage(messageId),
    onSuccess: () => void invalidateRoom(),
  });

  const handleSend = async (body: string): Promise<void> => {
    await sendMutation.mutateAsync(body);
  };

  const handleDelete = async (message: ChatMessage): Promise<void> => {
    await deleteMutation.mutateAsync(message.id);
  };

  const handleCommand = useCallback(
    async (text: string): Promise<boolean> => {
      if (!QUEST_COMMAND_RE.test(text)) {
        return false;
      }

      const remainder = text
        .replace(/\r\n/g, "\n")
        .slice(QUEST_COMMAND.length);
      const lines = remainder.split("\n");
      const title = (lines[0] ?? "").trim();
      const situation = lines.slice(1).join("\n").trim();

      if (title.length === 0) {
        // The composer shows a rejected command's message in its alert and
        // keeps the draft, so the adventurer can add the missing title.
        throw new Error(ko.chat.commandTitleRequired);
      }

      let created: CreateQuestFromChatResponse;
      try {
        created = await createQuestFromTavernMessage(projectId, {
          title,
          ...(situation.length > 0 ? { situation } : {}),
        });
      } catch {
        throw new Error(ko.chat.questCreateFailed);
      }

      pushToast(ko.chat.questCreated(created.quest.number, created.quest.title));
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.quests(projectId),
        }),
        queryClient.invalidateQueries({ queryKey: ["quests", projectId] }),
        invalidateRoom(),
      ]);
      return true;
    },
    [invalidateRoom, projectId, queryClient],
  );

  if (parsedProjectId === null) {
    return (
      <p role="alert" className="text-sm text-brick">
        {ko.errors.notFound}
      </p>
    );
  }

  return (
    <section className="mx-auto flex h-[calc(100vh-44px-2rem)] min-h-0 w-full max-w-screen-lg flex-col gap-2 text-ink">
      <h1 className="shrink-0 font-pixel text-[16px] leading-none text-ink">
        {ko.chat.title}
      </h1>

      <MessageList
        messages={messages}
        hasMore={messagesQuery.hasNextPage}
        onLoadMore={() => void messagesQuery.fetchNextPage()}
        projectId={projectId}
        meId={meQuery.data?.user.id ?? null}
        resolveName={resolveName}
        onDelete={handleDelete}
        onPromote={(message) => setPromoteTarget(message)}
        isPending={messagesQuery.isPending}
        isError={messagesQuery.isError}
        emptyText={ko.chat.tavernEmpty}
      />

      <MessageComposer
        onSubmit={handleSend}
        members={members}
        placeholder={ko.chat.tavernPlaceholder}
        commandHandler={handleCommand}
      />

      {promoteTarget !== null ? (
        <CreateQuestFromMessageDialog
          message={promoteTarget}
          projectId={projectId}
          resolveName={resolveName}
          onClose={() => setPromoteTarget(null)}
        />
      ) : null}
    </section>
  );
}
