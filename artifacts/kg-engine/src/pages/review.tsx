import { useState } from "react";
import { 
  useListReviewTasks, 
  getListReviewTasksQueryKey,
  useGetReviewStats,
  getGetReviewStatsQueryKey,
  useResolveReviewTask
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, Clock, AlertTriangle, GitMerge, Check, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function Review() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("pending");

  const { data: stats } = useGetReviewStats({
    query: { queryKey: getGetReviewStatsQueryKey(), refetchInterval: 10000 }
  });

  const { data: tasks, isLoading } = useListReviewTasks({
    query: { queryKey: getListReviewTasksQueryKey(), refetchInterval: 10000 }
  });

  const resolveTask = useResolveReviewTask();

  const handleResolve = (id: number, status: 'approved' | 'rejected' | 'deferred') => {
    resolveTask.mutate({ id, data: { status } }, {
      onSuccess: () => {
        // Optimistic update could go here
        queryClient.invalidateQueries({ queryKey: getListReviewTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetReviewStatsQueryKey() });
      }
    });
  };

  const filteredTasks = tasks?.filter(t => t.status === filter) || [];

  return (
    <div className="flex h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex-1 p-6 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-6 flex-none">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
            <p className="text-muted-foreground mt-1 text-sm">Human validation of AI-extracted knowledge</p>
          </div>
          
          <div className="flex bg-background border border-border rounded-md p-1">
            {['pending', 'approved', 'rejected', 'deferred'].map(status => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-4 py-1.5 text-sm font-medium rounded capitalize transition-colors ${
                  filter === status 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-4 -mr-4">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Card key={i} className="border-border bg-card/50">
                  <CardContent className="h-32 p-6 flex items-center justify-center text-muted-foreground">Loading...</CardContent>
                </Card>
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-border rounded-xl">
              <CheckCircle2 className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-foreground">Inbox Zero</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-2">No {filter} review tasks at the moment. Good job!</p>
            </div>
          ) : (
            <div className="space-y-4 pb-8">
              {filteredTasks.map(task => (
                <Card key={task.id} className="border-border/80 bg-card shadow-sm hover:border-primary/50 transition-colors overflow-hidden group flex flex-col">
                  <div className="h-1 w-full bg-gradient-to-r from-primary/40 to-transparent" />
                  <CardHeader className="py-3 px-4 bg-muted/30 border-b border-border/50 flex flex-row items-center justify-between space-y-0">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono uppercase text-[10px] bg-background">
                        {task.entityType.replace('_', ' ')}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                        <GitMerge className="h-3 w-3" />
                        {task.taskType.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {format(new Date(task.createdAt), "MMM d HH:mm")}
                    </div>
                  </CardHeader>
                  <CardContent className="p-5 flex-1">
                    <div className="flex items-start gap-4">
                      <div className="mt-1">
                        <AlertTriangle className="h-5 w-5 text-primary/80" />
                      </div>
                      <div>
                        <h4 className="text-base font-semibold text-foreground mb-1">
                          {task.entityName || `Entity #${task.entityId}`}
                        </h4>
                        {task.projectName && (
                          <div className="text-xs text-muted-foreground mb-3 font-mono">
                            Project: {task.projectName}
                          </div>
                        )}
                        <p className="text-sm text-muted-foreground bg-muted/40 p-3 rounded-md border border-border/50 font-mono">
                          {task.description || "No description provided."}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                  {task.status === 'pending' && (
                    <CardFooter className="p-4 bg-background border-t border-border flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleResolve(task.id, 'deferred')} className="border-border hover:bg-accent hover:text-accent-foreground text-xs">
                        <Clock className="h-3 w-3 mr-2" /> Defer
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleResolve(task.id, 'rejected')} className="bg-destructive/90 hover:bg-destructive text-xs">
                        <X className="h-3 w-3 mr-2" /> Reject
                      </Button>
                      <Button variant="default" size="sm" onClick={() => handleResolve(task.id, 'approved')} className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs">
                        <Check className="h-3 w-3 mr-2" /> Approve
                      </Button>
                    </CardFooter>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="w-80 border-l border-border bg-card/30 p-6 flex flex-col">
        <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-6">Review Stats</h3>
        
        {stats ? (
          <div className="space-y-6">
            <div className="p-4 bg-primary/10 rounded-xl border border-primary/20">
              <div className="text-4xl font-bold font-mono text-primary mb-1">{stats.pending}</div>
              <div className="text-xs uppercase tracking-wider font-semibold text-primary/80">Pending Tasks</div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Approved</span>
                <span className="font-mono font-medium">{stats.approved}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground"><XCircle className="h-4 w-4 text-destructive" /> Rejected</span>
                <span className="font-mono font-medium">{stats.rejected}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4 text-amber-500" /> Deferred</span>
                <span className="font-mono font-medium">{stats.deferred}</span>
              </div>
            </div>

            <div className="pt-6 border-t border-border">
              <div className="text-2xl font-bold font-mono">{stats.totalToday}</div>
              <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Processed Today</div>
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