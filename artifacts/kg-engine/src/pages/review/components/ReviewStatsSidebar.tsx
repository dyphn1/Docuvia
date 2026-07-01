import { useGetReviewStats, getGetReviewStatsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { CheckCircle2, XCircle, Clock } from "lucide-react";

export function ReviewStatsSidebar() {
  const { data: stats } = useGetReviewStats({
    query: { queryKey: getGetReviewStatsQueryKey(), refetchInterval: 10000 },
  });

  return (
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
                Click "Edit &amp; Correct" to modify AI-generated content
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
  );
}
