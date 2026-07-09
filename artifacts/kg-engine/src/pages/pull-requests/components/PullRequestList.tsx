import { GitPullRequest, ExternalLink, Loader2, Play } from "lucide-react";
import {
  type PullRequest,
  PullRequestState,
  PullRequestAnalysisStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  PR_LIST_SKELETON_COUNT,
  PR_STATE_BADGE_LABELS,
  PR_ANALYSIS_STATUS_BADGE_LABELS,
  PR_LIST_CARD_TITLE,
  PR_VIEW_IMPACT_BUTTON_LABEL,
  PR_ANALYZE_BUTTON_LABEL,
  PR_LIST_EMPTY_MESSAGE,
  PR_AUTHOR_PREFIX,
  PR_MERGED_DATE_PREFIX,
} from "@/constants/pull-requests";

function prStateBadge(state: PullRequestState) {
  switch (state) {
    case PullRequestState.open:
      return (
        <Badge variant="outline" className="text-blue-600 border-blue-300">
          {PR_STATE_BADGE_LABELS.open}
        </Badge>
      );
    case PullRequestState.merged:
      return (
        <Badge className="bg-purple-600 hover:bg-purple-700">{PR_STATE_BADGE_LABELS.merged}</Badge>
      );
    case PullRequestState.closed:
      return <Badge variant="secondary">{PR_STATE_BADGE_LABELS.closed}</Badge>;
    default:
      return <Badge variant="outline">{state}</Badge>;
  }
}

function analysisStatusBadge(status: PullRequestAnalysisStatus) {
  switch (status) {
    case PullRequestAnalysisStatus.completed:
      return (
        <Badge variant="outline" className="text-green-600 border-green-300">
          {PR_ANALYSIS_STATUS_BADGE_LABELS.completed}
        </Badge>
      );
    case PullRequestAnalysisStatus.in_progress:
      return (
        <Badge variant="outline" className="text-yellow-600 border-yellow-300">
          {PR_ANALYSIS_STATUS_BADGE_LABELS.in_progress}
        </Badge>
      );
    case PullRequestAnalysisStatus.failed:
      return <Badge variant="destructive">{PR_ANALYSIS_STATUS_BADGE_LABELS.failed}</Badge>;
    default:
      return <Badge variant="secondary">{PR_ANALYSIS_STATUS_BADGE_LABELS.pending}</Badge>;
  }
}

interface PrCardProps {
  pr: PullRequest;
  onViewImpact: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}

function PrCard({ pr, onViewImpact, onAnalyze, analyzing }: PrCardProps) {
  return (
    <div className="flex items-start gap-3 py-3 px-4 hover:bg-muted/50 rounded-md transition-colors">
      <GitPullRequest className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">#{pr.githubPrNumber}</span>
          <span className="text-sm truncate">{pr.title}</span>
          {prStateBadge(pr.state)}
          {analysisStatusBadge(pr.analysisStatus)}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {PR_AUTHOR_PREFIX}
          {pr.author}
          {pr.mergedAt && (
            <>
              {PR_MERGED_DATE_PREFIX}
              {new Date(pr.mergedAt).toLocaleDateString()}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {pr.analysisStatus === PullRequestAnalysisStatus.completed && (
          <Button size="sm" variant="outline" onClick={onViewImpact}>
            {PR_VIEW_IMPACT_BUTTON_LABEL}
          </Button>
        )}
        {(pr.analysisStatus === PullRequestAnalysisStatus.pending ||
          pr.analysisStatus === PullRequestAnalysisStatus.failed) && (
          <Button size="sm" variant="outline" onClick={onAnalyze} disabled={analyzing}>
            {analyzing ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Play className="h-3 w-3 mr-1" />
            )}
            {PR_ANALYZE_BUTTON_LABEL}
          </Button>
        )}
        <a href={pr.url} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="ghost">
            <ExternalLink className="h-3 w-3" />
          </Button>
        </a>
      </div>
    </div>
  );
}

interface PullRequestListProps {
  prs: PullRequest[] | undefined;
  isLoading: boolean;
  onViewImpact: (prNumber: number) => void;
  onAnalyze: (prNumber: number) => void;
  analyzingPrs: Set<number>;
}

export function PullRequestList({
  prs,
  isLoading,
  onViewImpact,
  onAnalyze,
  analyzingPrs,
}: PullRequestListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <GitPullRequest className="h-4 w-4" />
          {PR_LIST_CARD_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && (
          <div className="p-4 space-y-3">
            {Array.from({ length: PR_LIST_SKELETON_COUNT }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}
        {!isLoading && (!prs || prs.length === 0) && (
          <div className="p-6 text-center text-muted-foreground text-sm">
            {PR_LIST_EMPTY_MESSAGE}
          </div>
        )}
        {!isLoading && prs && prs.length > 0 && (
          <div className="divide-y">
            {prs.map((pr) => (
              <PrCard
                key={pr.id}
                pr={pr}
                onViewImpact={() => onViewImpact(pr.githubPrNumber)}
                onAnalyze={() => onAnalyze(pr.githubPrNumber)}
                analyzing={analyzingPrs.has(pr.githubPrNumber)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
