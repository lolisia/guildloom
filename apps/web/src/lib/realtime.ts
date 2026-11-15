/**
 * Socket.IO realtime bridge for the authenticated web shell.
 *
 * `AppLayout` mounts {@link useRealtime} once the adventurer is signed in, so
 * the socket's `gl_session` cookie handshake is always available. The hook:
 *
 * - opens one connection per mount (`io({ path: "/socket.io" })`) and closes it
 *   on unmount, which also makes React StrictMode's double mount harmless;
 * - joins the current guild's `project:<id>` room on connect and whenever the
 *   route's guild changes (leaving the previous room first);
 * - invalidates the TanStack Query caches named by each server broadcast and
 *   surfaces notification toasts / level-ups; and
 * - refreshes every active query after a reconnect, because the socket may
 *   have missed broadcasts while it was offline.
 */
import type { LevelUp, Notification } from "@guildloom/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

import { ko } from "../i18n/ko";
import { useLevelUpStore } from "./levelUp";
import { queryKeys } from "./queryKeys";
import { pushToast } from "./toast";

/** `quest:changed` payload: a quest row (and its detail/events) is stale. */
export interface QuestChangedEvent {
  projectId: number;
  questId: number;
}

/** `notification:new` payload: one notification for the current user. */
export interface NotificationNewEvent {
  notification: Notification;
}

/** `xp:changed` payload: the new XP/level, with the transition on level-up. */
export interface XpChangedEvent {
  userId: number;
  xp: number;
  level: number;
  levelUp?: LevelUp;
}

/** `members:changed` payload: a guild's member summary is stale. */
export interface MembersChangedEvent {
  projectId: number;
}

/** Events the server sends to the web client. */
export interface RealtimeServerToClientEvents {
  "quest:changed": (payload: QuestChangedEvent) => void;
  "notification:new": (payload: NotificationNewEvent) => void;
  "xp:changed": (payload: XpChangedEvent) => void;
  "members:changed": (payload: MembersChangedEvent) => void;
}

/** Events the web client sends to the server. */
export interface RealtimeClientToServerEvents {
  "subscribe:project": (
    payload: { projectId: number },
    ack?: (response: { ok: boolean }) => void,
  ) => void;
  "unsubscribe:project": (payload: { projectId: number }) => void;
}

/** Typed Socket.IO client used by the shell. */
export type RealtimeSocket = Socket<
  RealtimeServerToClientEvents,
  RealtimeClientToServerEvents
>;

/** Socket.IO endpoint; the HTTP server and the Vite dev proxy agree on it. */
export const REALTIME_PATH = "/socket.io";

/**
 * Connect the realtime client and keep the guild subscription in sync.
 *
 * Pass the guild from the route (`null` outside `/g/:projectId`). Private
 * user-room events (notifications, XP) still arrive without a guild, so the
 * connection itself does not depend on `projectId`.
 */
export function useRealtime(projectId: number | null): void {
  const queryClient = useQueryClient();
  const socketRef = useRef<RealtimeSocket | null>(null);
  const projectIdRef = useRef(projectId);
  /** Guild currently joined through `subscribe:project`, if any. */
  const subscribedRef = useRef<number | null>(null);

  // Keep the desired guild readable from the connect handler (which survives
  // guild changes) without re-opening the socket.
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    const socket = io({ path: REALTIME_PATH });
    socketRef.current = socket;
    subscribedRef.current = null;
    let hasConnected = false;

    const handleConnect = (): void => {
      // A new connection has no rooms yet; join the current guild and (on a
      // reconnect) refresh caches that may have missed broadcasts.
      subscribedRef.current = null;
      const target = projectIdRef.current;
      if (target !== null) {
        socket.emit("subscribe:project", { projectId: target });
        subscribedRef.current = target;
      }

      if (hasConnected) {
        void queryClient.invalidateQueries();
      }
      hasConnected = true;
    };

    const handleQuestChanged = (payload: QuestChangedEvent): void => {
      // `["quests", projectId]` is a prefix, so every filtered board query
      // for this guild is covered too.
      void queryClient.invalidateQueries({
        queryKey: ["quests", payload.projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.quest(payload.questId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events(payload.questId),
      });
    };

    const handleNotification = (payload: NotificationNewEvent): void => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications,
      });
      // The inline 수락 / 패스 actions in the bell come from the pending
      // nomination list; a new nomination must refresh it even while the
      // dropdown is closed (the query is disabled then).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.myNominations,
      });
      pushToast(ko.notifications.format(payload.notification));
    };

    const handleXpChanged = (payload: XpChangedEvent): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      if (payload.levelUp) {
        useLevelUpStore.getState().show(payload.levelUp);
      }
    };

    const handleMembersChanged = (payload: MembersChangedEvent): void => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.project(payload.projectId),
      });
    };

    socket.on("connect", handleConnect);
    socket.on("quest:changed", handleQuestChanged);
    socket.on("notification:new", handleNotification);
    socket.on("xp:changed", handleXpChanged);
    socket.on("members:changed", handleMembersChanged);

    // A mock or a very fast transport may already be connected before the
    // listeners above were attached.
    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("quest:changed", handleQuestChanged);
      socket.off("notification:new", handleNotification);
      socket.off("xp:changed", handleXpChanged);
      socket.off("members:changed", handleMembersChanged);
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      subscribedRef.current = null;
    };
  }, [queryClient]);

  // Guild switch: leave the previous project room and join the new one. The
  // connect handler follows `projectIdRef`, so this only runs while online.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      return;
    }

    const previous = subscribedRef.current;
    if (previous === projectId) {
      return;
    }
    if (previous !== null) {
      socket.emit("unsubscribe:project", { projectId: previous });
    }
    subscribedRef.current = projectId;
    if (projectId !== null) {
      socket.emit("subscribe:project", { projectId });
    }
  }, [projectId]);
}
