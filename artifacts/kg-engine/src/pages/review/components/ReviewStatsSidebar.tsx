import { useGetReviewStats, getGetReviewStatsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import {
  REVIEW_STATS_REFETCH_INTERVAL_MS,
  REVIEW_STATS_TITLE,
  REVIEW_STATS_PENDING_LABEL,
  REVIEW_STATS_APPROVED_LABEL,
  REVIEW_STATS_REJECTED_LABEL,
  REVIEW_STATS_DEFERRED_LABEL,
  REVIEW_STATS_REVIEWED_TODAY_LABEL,
  REVIEW_HOW_TO_TITLE,
  REVIEW_HOW_TO_STEPS,
} from "@/constants/review";

export function ReviewStatsSidebar() {
  const { data: stats } = useGetReviewStats({
    query: {
      queryKey: getGetReviewStatsQueryKey(),
      refetchInterval: REVIEW_STATS_REFETCH_INTERVAL_MS,
    },
  });

  return (
    <div className="w-72 border-l border-border bg-card/30 p-5 flex flex-col shrink-0">
      <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-5">
        {REVIEW_STATS_TITLE}
      </h3>

      {stats ? (
        <div className="space-y-5">
          <div className="p-4 bg-primary/10 rounded-xl border border-primary/20">
            <div className="text-4xl font-bold font-mono text-primary mb-1">{stats.pending}</div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-primary/80">
              {REVIEW_STATS_PENDING_LABEL}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{" "}
                {REVIEW_STATS_APPROVED_LABEL}
              </span>
              <span className="font-mono font-medium text-sm">{stats.approved}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground text-xs">
                <XCircle className="h-3.5 w-3.5 text-destructive" /> {REVIEW_STATS_REJECTED_LABEL}
              </span>
              <span className="font-mono font-medium text-sm">{stats.rejected}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground text-xs">
                <Clock className="h-3.5 w-3.5 text-amber-500" /> {REVIEW_STATS_DEFERRED_LABEL}
              </span>
              <span className="font-mono font-medium text-sm">{stats.deferred}</span>
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <div className="text-2xl font-bold font-mono">{stats.totalToday}</div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mt-0.5">
              {REVIEW_STATS_REVIEWED_TODAY_LABEL}
            </div>
          </div>

          <div className="pt-4 border-t border-border space-y-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              {REVIEW_HOW_TO_TITLE}
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              {REVIEW_HOW_TO_STEPS.map((step, i) => (
                <div key={step} className="flex items-start gap-1.5">
                  <span className="text-primary font-mono shrink-0">{i + 1}.</span>
                  {step}
                </div>
              ))}
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
