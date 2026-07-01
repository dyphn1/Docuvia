import { GitPullRequest, ExternalLink, Loader2, Play } from "lucide-react";
import { type PullRequest } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

function prStateBadge(state: string) {
  switch (state) {
    case "open":
      return (
        <Badge variant="outline" className="text-blue-600 border-blue-300">
          open
        </Badge>
      );
    case "merged":
      return <Badge className="bg-purple-600 hover:bg-purple-700">merged</Badge>;
    case "closed":
      return <Badge variant="secondary">closed</Badge>;
    default:
      return <Badge variant="outline">{state}</Badge>;
  }
}

function analysisStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="outline" className="text-green-600 border-green-300">
          analyzed
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="outline" className="text-yellow-600 border-yellow-300">
          analyzing…
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">failed</Badge>;
    default:
      return <Badge variant="secondary">pending</Badge>;
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
          by {pr.author}
          {pr.mergedAt && <> · merged {new Date(pr.mergedAt).toLocaleDateString()}</>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {pr.analysisStatus === "completed" && (
          <Button size="sm" variant="outline" onClick={onViewImpact}>
            View Impact
          </Button>
        )}
        {(pr.analysisStatus === "pending" || pr.analysisStatus === "failed") && (
          <Button size="sm" variant="outline" onClick={onAnalyze} disabled={analyzing}>
            {analyzing ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Play className="h-3 w-3 mr-1" />
            )}
            Analyze
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
          Pull Requests
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}
        {!isLoading && (!prs || prs.length === 0) && (
          <div className="p-6 text-center text-muted-foreground text-sm">
            No pull requests found. Configure the webhook above to start receiving PR events.
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
