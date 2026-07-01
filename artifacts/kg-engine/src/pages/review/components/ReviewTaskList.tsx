import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2 } from "lucide-react";
import {
  useListReviewTasks,
  getListReviewTasksQueryKey,
  useResolveReviewTask,
  getGetReviewStatsQueryKey,
  type ReviewTask,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ReviewTaskDetail } from "./ReviewTaskDetail";

export function ReviewTaskList() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("pending");

  const { data: tasksData, isLoading } = useListReviewTasks({
    query: { queryKey: getListReviewTasksQueryKey(), refetchInterval: 10000 },
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
  const tabCounts = {
    pending: tasks.filter((t) => t.status === "pending").length,
    approved: tasks.filter((t) => t.status === "approved").length,
    rejected: tasks.filter((t) => t.status === "rejected").length,
    deferred: tasks.filter((t) => t.status === "deferred").length,
  };

  return (
    <div className="flex-1 p-6 flex flex-col min-w-0">
      <div className="flex items-center justify-between mb-5 flex-none">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Human validation of AI-extracted knowledge — expand cards to view &amp; correct content
          </p>
        </div>

        <div className="flex bg-background border border-border rounded-lg p-1 gap-0.5">
          {(["pending", "approved", "rejected", "deferred"] as const).map((status) => (
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
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-8 border border-dashed border-border rounded-xl">
            <CheckCircle2 className="h-12 w-12 text-muted-foreground mb-4 opacity-30" />
            <h3 className="text-base font-medium text-foreground">No {filter} tasks</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-2">
              {filter === "pending"
                ? "Run the AI pipeline in Ingest & Generate to create review tasks."
                : `No tasks have been ${filter} yet.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-8">
            {filteredTasks.map((task) => (
              <ReviewTaskDetail key={task.id} task={task as any} onResolve={handleResolve} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
