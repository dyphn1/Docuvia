import { useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { CheckCircle2 } from "lucide-react";
import {
  useListReviewTasks,
  getListReviewTasksQueryKey,
  useResolveReviewTask,
  getGetReviewStatsQueryKey,
  ReviewTaskStatus,
  type ReviewTask,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ReviewTaskDetail } from "./ReviewTaskDetail";
import {
  REVIEW_TASKS_REFETCH_INTERVAL_MS,
  REVIEW_TASK_LIST_SKELETON_COUNT,
  REVIEW_QUEUE_TITLE,
  REVIEW_QUEUE_SUBTITLE,
  REVIEW_NO_TASKS_TITLE_PREFIX,
  REVIEW_NO_TASKS_TITLE_SUFFIX,
  REVIEW_NO_PENDING_TASKS_MESSAGE,
  REVIEW_NO_TASKS_RESOLVED_PREFIX,
  REVIEW_NO_TASKS_RESOLVED_SUFFIX,
} from "@/constants/review";

const REVIEW_TASK_STATUSES = Object.values(ReviewTaskStatus);

export function ReviewTaskList() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ReviewTaskStatus>(ReviewTaskStatus.pending);

  const { data: tasksData, isLoading } = useListReviewTasks({
    query: {
      queryKey: getListReviewTasksQueryKey(),
      refetchInterval: REVIEW_TASKS_REFETCH_INTERVAL_MS,
    },
  });

  const resolveTask = useResolveReviewTask();

  const handleResolve = (
    id: number,
    status: "approved" | "rejected" | "deferred",
    correctedValue?: string
  ) => {
    resolveTask.mutate(
      { id, data: { status, correctedValue } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListReviewTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetReviewStatsQueryKey() });
        },
      }
    );
  };

  const tasks = Array.isArray(tasksData) ? (tasksData as ReviewTask[]) : [];

  const filteredTasks = tasks.filter((t) => t.status === filter);
  const tabCounts = Object.fromEntries(
    REVIEW_TASK_STATUSES.map((status) => [status, tasks.filter((t) => t.status === status).length])
  ) as Record<ReviewTaskStatus, number>;

  return (
    <div className="flex-1 p-6 flex flex-col min-w-0">
      <div className="flex items-center justify-between mb-5 flex-none">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{REVIEW_QUEUE_TITLE}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{REVIEW_QUEUE_SUBTITLE}</p>
        </div>

        <div className="flex bg-background border border-border rounded-lg p-1 gap-0.5">
          {REVIEW_TASK_STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors flex items-center gap-1.5 ${
                filter === status
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              {status}
              <span
                className={`text-[10px] font-mono px-1 rounded ${
                  filter === status ? "bg-primary-foreground/20" : "bg-muted"
                }`}
              >
                {tabCounts[status]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-4 -mr-4">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: REVIEW_TASK_LIST_SKELETON_COUNT }, (_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-8 border border-dashed border-border rounded-xl">
            <CheckCircle2 className="h-12 w-12 text-muted-foreground mb-4 opacity-30" />
            <h3 className="text-base font-medium text-foreground">
              {REVIEW_NO_TASKS_TITLE_PREFIX} {filter} {REVIEW_NO_TASKS_TITLE_SUFFIX}
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-2">
              {filter === ReviewTaskStatus.pending
                ? REVIEW_NO_PENDING_TASKS_MESSAGE
                : `${REVIEW_NO_TASKS_RESOLVED_PREFIX} ${filter} ${REVIEW_NO_TASKS_RESOLVED_SUFFIX}`}
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-8">
            {filteredTasks.map((task) => (
              <ReviewTaskDetail key={task.id} task={task} onResolve={handleResolve} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
