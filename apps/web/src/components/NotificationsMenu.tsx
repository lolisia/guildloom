/**
 * Top-bar notification bell.
 *
 * The trigger shows the pack's 32px `notification` icon plus the unread-count
 * badge from `GET /api/notifications`. The paper dropdown lists notifications
 * newest first with Korean templates and relative time; selecting one opens
 * its quest and marks it read, and "모두 읽음" clears the badge.
 *
 * Notifications that still have a pending nomination for the current
 * adventurer (`GET /api/me/nominations`) also expose inline 수락 / 패스
 * actions. 패스 opens the shared {@link PassReasonDialog}.
 */
import type { MyNomination, Notification } from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  fetchNotifications,
  markNotificationsRead,
} from "../api/notifications";
import { accept, fetchMyNominations } from "../api/party";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";
import Icon from "./Icon";
import PassReasonDialog from "./PassReasonDialog";
import { Button } from "./ui";

/** Notification types whose quest can still be accepted/passed. */
const RESPONDABLE_TYPES = new Set<Notification["type"]>([
  "nominated",
  "relayed",
  "reinforce",
]);

interface AcceptTarget {
  nominationId: number;
  projectId: number;
  questId: number;
}

interface PassTarget extends AcceptTarget {
  /** Nomination actor, kept out of the toss member list. */
  actorUserId: number | null;
}

/** Props for {@link NotificationsMenu}. */
export interface NotificationsMenuProps {
  className?: string;
}

/** Bell trigger, unread badge and notification dropdown. */
export function NotificationsMenu({ className }: NotificationsMenuProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [passTarget, setPassTarget] = useState<PassTarget | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: ({ signal }) => fetchNotifications({ signal }),
    retry: false,
  });

  const nominationsQuery = useQuery({
    queryKey: queryKeys.myNominations,
    queryFn: ({ signal }) => fetchMyNominations(signal),
    // The inline actions are only visible while the dropdown is open.
    enabled: open,
    retry: false,
  });

  const readMutation = useMutation({
    mutationFn: (body: { ids?: number[]; all?: boolean }) =>
      markNotificationsRead(body),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });

  const acceptMutation = useMutation({
    mutationFn: (target: AcceptTarget) => accept(target.nominationId),
    onSuccess: async (_data, target) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
        queryClient.invalidateQueries({ queryKey: queryKeys.myNominations }),
        queryClient.invalidateQueries({
          queryKey: ["quests", target.projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.quest(target.questId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.events(target.questId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.project(target.projectId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      ]);
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
      if (event.key !== "Escape") {
        return;
      }
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const notifications = useMemo(() => {
    const items = notificationsQuery.data?.items ?? [];
    return [...items].sort(
      (left, right) => right.createdAt - left.createdAt,
    );
  }, [notificationsQuery.data]);

  /** Pending nomination per quest, for the inline accept/pass row. */
  const pendingByQuest = useMemo(() => {
    const map = new Map<number, MyNomination>();
    for (const nomination of nominationsQuery.data ?? []) {
      if (nomination.state === "pending") {
        map.set(nomination.questId, nomination);
      }
    }
    return map;
  }, [nominationsQuery.data]);

  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  const openNotification = (notification: Notification): void => {
    if (notification.readAt === null) {
      readMutation.mutate({ ids: [notification.id] });
    }
    setOpen(false);

    const guildPath = `/g/${notification.projectId}`;
    if (notification.questId === null) {
      navigate(guildPath);
      return;
    }
    navigate(`${guildPath}?quest=${notification.questId}`);
  };

  const markAllRead = (): void => {
    if (unreadCount === 0 || readMutation.isPending) {
      return;
    }
    readMutation.mutate({ all: true });
  };

  const containerClasses = className
    ? `relative ${className}`
    : "relative";

  return (
    <div ref={containerRef} className={containerClasses}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ko.notifications.label}
        onClick={() => setOpen((current) => !current)}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors hover:bg-sunken"
      >
        <Icon name="notification" size={32} />
        {unreadCount > 0 ? (
          <span
            data-testid="notification-unread-badge"
            className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-sm border-[1.5px] border-line-strong bg-paper px-1 font-pixel text-[12px] leading-4 text-ink"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={ko.notifications.title}
          className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-sm border-[1.5px] border-line-strong bg-paper shadow-hard"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <h2 className="text-sm font-semibold text-ink">
              {ko.notifications.title}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={markAllRead}
              disabled={unreadCount === 0 || readMutation.isPending}
            >
              {ko.notifications.markAllRead}
            </Button>
          </div>

          {readMutation.isError ? (
            <p role="alert" className="px-3 py-2 text-xs text-brick">
              {ko.notifications.markAllReadFailed}
            </p>
          ) : null}

          {notificationsQuery.isPending ? (
            <p className="px-3 py-3 text-xs text-muted">
              {ko.notifications.loading}
            </p>
          ) : null}

          {notificationsQuery.isError ? (
            <p role="alert" className="px-3 py-3 text-xs text-brick">
              {ko.notifications.loadFailed}
            </p>
          ) : null}

          {!notificationsQuery.isPending &&
          !notificationsQuery.isError &&
          notifications.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted">
              {ko.notifications.empty}
            </p>
          ) : null}

          {notifications.length > 0 ? (
            <ul className="max-h-96 overflow-y-auto">
              {notifications.map((notification) => {
                const questId = notification.questId;
                const nomination =
                  questId !== null && RESPONDABLE_TYPES.has(notification.type)
                    ? pendingByQuest.get(questId)
                    : undefined;
                const accepting =
                  acceptMutation.isPending &&
                  acceptMutation.variables?.nominationId ===
                    nomination?.id;

                return (
                  <li
                    key={notification.id}
                    data-testid={`notification-${notification.id}`}
                    data-unread={notification.readAt === null}
                    className="border-b border-line last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-sunken"
                    >
                      <span
                        className={
                          notification.readAt === null
                            ? "text-[13px] font-medium text-ink"
                            : "text-[13px] text-muted"
                        }
                      >
                        {ko.notifications.format(notification)}
                      </span>
                      <span className="text-xs text-muted">
                        {ko.time.relative(notification.createdAt)}
                      </span>
                    </button>

                    {nomination && questId !== null ? (
                      <div className="flex items-center gap-1.5 px-3 pb-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={accepting}
                          onClick={() =>
                            acceptMutation.mutate({
                              nominationId: nomination.id,
                              projectId: notification.projectId,
                              questId,
                            })
                          }
                        >
                          {accepting
                            ? ko.notifications.accepting
                            : ko.notifications.accept}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setPassTarget({
                              nominationId: nomination.id,
                              projectId: notification.projectId,
                              questId,
                              actorUserId: notification.actor?.id ?? null,
                            })
                          }
                        >
                          {ko.notifications.pass}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {acceptMutation.isError ? (
            <p role="alert" className="px-3 py-2 text-xs text-brick">
              {ko.notifications.acceptFailed}
            </p>
          ) : null}
        </div>
      ) : null}

      {passTarget ? (
        <PassReasonDialog
          nominationId={passTarget.nominationId}
          projectId={passTarget.projectId}
          excludeUserIds={
            passTarget.actorUserId === null
              ? undefined
              : [passTarget.actorUserId]
          }
          onClose={() => setPassTarget(null)}
          onPassed={() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.quest(passTarget.questId),
            });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.events(passTarget.questId),
            });
          }}
        />
      ) : null}
    </div>
  );
}

export default NotificationsMenu;
