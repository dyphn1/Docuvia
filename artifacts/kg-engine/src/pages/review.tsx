import { useState } from "react";
import {
  useListReviewTasks,
  getListReviewTasksQueryKey,
  useGetReviewStats,
  getGetReviewStatsQueryKey,
  useResolveReviewTask,
  type ReviewTask,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  GitMerge,
  Check,
  X,
  Edit3,
  ChevronDown,
  ChevronUp,
  Tag,
  Network,
  Layers,
} from "lucide-react";
import { format } from "date-fns";

const entityIcons = {
  l1_tag: Tag,
  l2_node: GitMerge,
  l3_node: Network,
};

const nodeTypeBadgeColors: Record<string, string> = {
  module: "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400",
  package: "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400",
  pcd: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  change: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  rule: "bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400",
  decision: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400",
  context: "bg-sky-500/10 border-sky-500/20 text-sky-600 dark:text-sky-400",
};

interface TaskCardProps {
  task: {
    id: number;
    entityType: string;
    entityId: number;
    entityName?: string | null;
    taskType: string;
    status: string;
    description?: string | null;
    nodeContent?: string | null;
    nodeType?: string | null;
    projectName?: string | null;
    correctedValue?: string | null;
    createdAt: string;
    resolvedAt?: string | null;
  };
  onResolve: (
    id: number,
    status: "approved" | "rejected" | "deferred",
    correctedValue?: string
  ) => void;
}

function TaskCard({ task, onResolve }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [correction, setCorrection] = useState(task.nodeContent ?? "");

  const Icon = entityIcons[task.entityType as keyof typeof entityIcons] ?? Layers;

  const handleApproveWithCorrection = () => {
    onResolve(task.id, "approved", correction !== task.nodeContent ? correction : undefined);
    setEditMode(false);
  };

  return (
    <Card className="border-border/80 bg-card shadow-sm hover:border-primary/40 transition-colors overflow-hidden flex flex-col">
      <div className="h-0.5 w-full bg-gradient-to-r from-primary/60 to-transparent" />
      <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary" />
          <Badge
            variant="outline"
            className="font-mono uppercase text-[10px] bg-background px-1.5 py-0"
          >
            {task.entityType.replace("_", " ")}
          </Badge>
          {task.nodeType && (
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${nodeTypeBadgeColors[task.nodeType] ?? ""}`}
            >
              {task.nodeType}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground font-mono">
            {task.taskType.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">
            {format(new Date(task.createdAt), "MMM d HH:mm")}
          </span>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-4 flex-1">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-foreground mb-1">
              {task.entityName ?? `Entity #${task.entityId}`}
            </h4>
            {task.projectName && (
              <div className="text-xs text-muted-foreground mb-2 font-mono">
                Project: {task.projectName}
              </div>
            )}
            <p className="text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-md border border-border/50 font-mono">
              {task.description ?? "No description provided."}
            </p>

            {expanded && task.nodeContent && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                    Node Content
                  </Label>
                  {task.status === "pending" && (
                    <button
                      onClick={() => setEditMode((e) => !e)}
                      className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 font-medium"
                    >
                      <Edit3 className="h-2.5 w-2.5" />
                      {editMode ? "Cancel Edit" : "Edit & Correct"}
                    </button>
                  )}
                </div>
                {editMode ? (
                  <Textarea
                    value={correction}
                    onChange={(e) => setCorrection(e.target.value)}
                    className="text-xs font-mono min-h-24 resize-none bg-background border-primary/30 focus:border-primary"
                    placeholder="Enter corrected content..."
                  />
                ) : (
                  <pre className="text-xs font-mono bg-muted/40 p-2.5 rounded-md border border-border/50 whitespace-pre-wrap text-foreground/90 max-h-48 overflow-y-auto">
                    {task.nodeContent}
                  </pre>
                )}
              </div>
            )}

            {task.correctedValue && task.status !== "pending" && (
              <div className="mt-3 space-y-1">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                  Human Correction
                </Label>
                <pre className="text-xs font-mono bg-emerald-500/5 border border-emerald-500/20 p-2.5 rounded-md text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap">
                  {task.correctedValue}
                </pre>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      {task.status === "pending" && (
        <CardFooter className="p-3 bg-muted/10 border-t border-border flex justify-between items-center">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            {expanded ? "Hide" : "Show"} content
          </button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onResolve(task.id, "deferred")}
              className="h-7 text-xs border-border"
            >
              <Clock className="h-3 w-3 mr-1" /> Defer
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onResolve(task.id, "rejected")}
              className="h-7 text-xs bg-destructive/90"
            >
              <X className="h-3 w-3 mr-1" /> Reject
            </Button>
            {editMode ? (
              <Button
                size="sm"
                onClick={handleApproveWithCorrection}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Check className="h-3 w-3 mr-1" /> Save & Approve
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => onResolve(task.id, "approved")}
                className="h-7 text-xs"
              >
                <Check className="h-3 w-3 mr-1" /> Approve
              </Button>
            )}
          </div>
        </CardFooter>
      )}
    </Card>
  );
}

export default function Review() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("pending");

  const { data: stats } = useGetReviewStats({
    query: { queryKey: getGetReviewStatsQueryKey(), refetchInterval: 10000 },
  });

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
    <div className="flex h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex-1 p-6 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-5 flex-none">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Human validation of AI-extracted knowledge — expand cards to view &amp; correct
              content
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
                  className={`text-[10px] font-mono px-1 rounded ${filter === status ? "bg-primary-foreground/20" : "bg-muted"}`}
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
                <TaskCard key={task.id} task={task as any} onResolve={handleResolve} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="w-72 border-l border-border bg-card/30 p-5 flex flex-col shrink-0">
        <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-5">
          Review Stats
        </h3>

        {stats ? (
          <div className="space-y-5">
            <div className="p-4 bg-primary/10 rounded-xl border border-primary/20">
              <div className="text-4xl font-bold font-mono text-primary mb-1">{stats.pending}</div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-primary/80">
                Pending Tasks
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Approved
                </span>
                <span className="font-mono font-medium text-sm">{stats.approved}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground text-xs">
                  <XCircle className="h-3.5 w-3.5 text-destructive" /> Rejected
                </span>
                <span className="font-mono font-medium text-sm">{stats.rejected}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Clock className="h-3.5 w-3.5 text-amber-500" /> Deferred
                </span>
                <span className="font-mono font-medium text-sm">{stats.deferred}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <div className="text-2xl font-bold font-mono">{stats.totalToday}</div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mt-0.5">
                Reviewed Today
              </div>
            </div>

            <div className="pt-4 border-t border-border space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                How to Review
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-start gap-1.5">
                  <span className="text-primary font-mono shrink-0">1.</span>
                  Click the arrow to expand a card and view full content
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-primary font-mono shrink-0">2.</span>
                  Click "Edit & Correct" to modify AI-generated content
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-primary font-mono shrink-0">3.</span>
                  Approve/Reject to resolve — corrections write back to the node
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
      </div>
    </div>
  );
}
