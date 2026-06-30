import { useState } from "react";
import { GitPullRequest, ExternalLink, Loader2, Play, RefreshCw } from "lucide-react";
import {
  useListProjects,
  getListProjectsQueryKey,
  useListPullRequests,
  getListPullRequestsQueryKey,
  useGetPullRequestDetail,
  getGetPullRequestDetailQueryKey,
  useAnalyzePullRequest,
  type PullRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { normalizeProjects } from "@/lib/projects";

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

interface PrDetailPanelProps {
  projectId: number;
  prNumber: number;
  open: boolean;
  onClose: () => void;
}

function PrDetailPanel({ projectId, prNumber, open, onClose }: PrDetailPanelProps) {
  const { data, isLoading } = useGetPullRequestDetail(projectId, prNumber, {
    query: {
      queryKey: getGetPullRequestDetailQueryKey(projectId, prNumber),
      enabled: open,
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>PR #{prNumber} — Knowledge Impact</SheetTitle>
          <SheetDescription>
            L2 modules and L3 decisions affected by this pull request.
          </SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        {data && (
          <div className="mt-6 space-y-6">
            <div className="flex gap-3 text-sm text-muted-foreground">
              <span>
                <strong>{data.commitsCount}</strong> commits
              </span>
              <span>•</span>
              <span>
                <strong>{data.l2Nodes.length}</strong> modules
              </span>
              <span>•</span>
              <span>
                <strong>{data.l3Nodes.length}</strong> decisions
              </span>
            </div>

            {data.aiSummary && (
              <div>
                <h3 className="font-semibold text-sm mb-2">AI Impact Summary</h3>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted rounded-md p-3 leading-relaxed">
                  {data.aiSummary}
                </div>
              </div>
            )}

            {data.l2Nodes.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-2">Modules Affected</h3>
                <div className="space-y-2">
                  {data.l2Nodes.map((node) => (
                    <div key={node.id} className="flex items-start gap-2 text-sm">
                      <Badge variant="outline" className="text-xs shrink-0">
                        {node.type}
                      </Badge>
                      <div>
                        <div className="font-medium">{node.name}</div>
                        {node.description && (
                          <div className="text-muted-foreground text-xs">{node.description}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.l3Nodes.length > 0 && (
              <div>
                <Separator />
                <h3 className="font-semibold text-sm mt-4 mb-2">Decisions & Changes</h3>
                <div className="space-y-2">
                  {data.l3Nodes.map((node) => (
                    <div key={node.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {node.nodeType}
                        </Badge>
                        <span className="font-medium">{node.title}</span>
                      </div>
                      {node.content && (
                        <p className="text-muted-foreground text-xs mt-1 ml-1 line-clamp-3">
                          {node.content}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!data.aiSummary && data.l2Nodes.length === 0 && data.l3Nodes.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No knowledge graph changes detected yet. Try running "Analyze Now".
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
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

export default function PullRequests() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [detailPr, setDetailPr] = useState<{ projectId: number; prNumber: number } | null>(null);
  const [analyzingPrs, setAnalyzingPrs] = useState<Set<number>>(new Set());

  const { data: projectsData } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = normalizeProjects(projectsData);

  const projectId = parseInt(selectedProjectId, 10);
  const isValidProject = !!selectedProjectId && !isNaN(projectId);

  const {
    data: prs,
    isLoading,
    refetch,
  } = useListPullRequests(projectId, {
    query: {
      queryKey: getListPullRequestsQueryKey(projectId),
      enabled: isValidProject,
      refetchInterval: 15000,
    },
  });

  const { mutate: analyzePr } = useAnalyzePullRequest({
    mutation: {
      onSuccess: (_data, variables) => {
        const prNum = variables.prNumber as number;
        setAnalyzingPrs((prev) => {
          const next = new Set(prev);
          next.delete(prNum);
          return next;
        });
        queryClient.invalidateQueries({ queryKey: getListPullRequestsQueryKey(projectId) });
      },
      onError: (_err, variables) => {
        const prNum = variables.prNumber as number;
        setAnalyzingPrs((prev) => {
          const next = new Set(prev);
          next.delete(prNum);
          return next;
        });
      },
    },
  });

  const handleAnalyze = (prNumber: number) => {
    setAnalyzingPrs((prev) => new Set(prev).add(prNumber));
    analyzePr({ id: projectId, prNumber });
  };

  const webhookEndpoint = isValidProject
    ? `${window.location.origin}/api/webhooks/github/${projectId}`
    : "/api/webhooks/github/{projectId}";

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">GitHub PR Integration</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Automatically ingest PR commits into the knowledge graph and generate AI impact summaries.
        </p>
      </div>

      {/* Project selector */}
      <div className="flex items-center gap-3">
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a project…" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isValidProject && (
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        )}
      </div>

      {/* Webhook setup card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Webhook Setup</CardTitle>
          <CardDescription>
            Configure this endpoint in your GitHub repository settings to receive PR events.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Payload URL:</span>
            <code className="ml-2 text-xs bg-muted px-2 py-1 rounded font-mono break-all">
              {webhookEndpoint}
            </code>
          </div>
          <div>
            <span className="text-muted-foreground">Content type:</span>
            <code className="ml-2 text-xs bg-muted px-2 py-1 rounded font-mono">
              application/json
            </code>
          </div>
          <div>
            <span className="text-muted-foreground">Secret:</span>
            <span className="ml-2 text-xs text-muted-foreground">
              Set <code className="bg-muted px-1 rounded">GITHUB_WEBHOOK_SECRET</code> env var on
              the server
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Events:</span>
            <Badge variant="outline" className="ml-2 text-xs">
              pull_request
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* PR list */}
      {isValidProject && (
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
                    onViewImpact={() => setDetailPr({ projectId, prNumber: pr.githubPrNumber })}
                    onAnalyze={() => handleAnalyze(pr.githubPrNumber)}
                    analyzing={analyzingPrs.has(pr.githubPrNumber)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isValidProject && (
        <div className="text-center text-muted-foreground text-sm py-12">
          Select a project to view its pull requests.
        </div>
      )}

      {detailPr && (
        <PrDetailPanel
          projectId={detailPr.projectId}
          prNumber={detailPr.prNumber}
          open={!!detailPr}
          onClose={() => setDetailPr(null)}
        />
      )}
    </div>
  );
}
