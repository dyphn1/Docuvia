import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjectNotifications,
  getListProjectNotificationsQueryKey,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { ScrollArea } from "@/components/ui/ScrollArea";
import {
  NOTIFICATION_POLL_INTERVAL_MS,
  RECENT_NOTIFICATIONS_LIMIT,
  UNREAD_COUNT_DISPLAY_CAP,
  PAYLOAD_SUMMARY_MAX_LENGTH,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_BELL_HEADER_TEXT,
  NOTIFICATION_BELL_MARK_ALL_READ_TEXT,
  NOTIFICATION_BELL_EMPTY_TEXT,
} from "@/constants/app";

function getPayloadSummary(payload: Record<string, unknown>): string {
  if (typeof payload.summary === "string") return payload.summary;
  if (typeof payload.message === "string") return payload.message;
  return JSON.stringify(payload).slice(0, PAYLOAD_SUMMARY_MAX_LENGTH);
}

interface NotificationBellProps {
  projectId: number;
}

export function NotificationBell({ projectId }: NotificationBellProps) {
  const queryClient = useQueryClient();

  const { data } = useListProjectNotifications(projectId, undefined, {
    query: {
      queryKey: getListProjectNotificationsQueryKey(projectId),
      refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
      enabled: !!projectId,
    },
  });

  const notifications = data?.items ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;
  const recent = notifications.slice(0, RECENT_NOTIFICATIONS_LIMIT);

  const { mutate: markRead } = useMarkNotificationRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListProjectNotificationsQueryKey(projectId),
        });
      },
    },
  });

  const { mutate: markAllRead } = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListProjectNotificationsQueryKey(projectId),
        });
      },
    },
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" disabled={!projectId}>
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center font-medium leading-none">
              {unreadCount > UNREAD_COUNT_DISPLAY_CAP
                ? `${UNREAD_COUNT_DISPLAY_CAP}+`
                : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold text-sm">{NOTIFICATION_BELL_HEADER_TEXT}</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => markAllRead({ data: { projectId } })}
            >
              {NOTIFICATION_BELL_MARK_ALL_READ_TEXT}
            </Button>
          )}
        </div>
        <ScrollArea className="h-80">
          {recent.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
              {NOTIFICATION_BELL_EMPTY_TEXT}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recent.map((n) => {
                const typeInfo = NOTIFICATION_TYPE_LABELS[n.type] ?? {
                  label: n.type,
                  className: "",
                };
                return (
                  <button
                    key={n.id}
                    className={`w-full text-left px-4 py-3 hover:bg-accent transition-colors ${
                      !n.read ? "bg-primary/5" : ""
                    }`}
                    onClick={() => {
                      if (!n.read) markRead({ notificationId: n.id });
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 mt-0.5 px-1 py-0 ${typeInfo.className}`}
                      >
                        {typeInfo.label}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground leading-snug line-clamp-2">
                          {getPayloadSummary(n.payload)}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      {!n.read && (
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1.5" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
