import { useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  useListProjects,
  getListProjectsQueryKey,
  useListPullRequests,
  getListPullRequestsQueryKey,
  useAnalyzePullRequest,
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
import { normalizeProjects } from "@/lib/projects";
import { PullRequestList } from "./pull-requests/components/PullRequestList";
import { PullRequestDetail } from "./pull-requests/components/PullRequestDetail";

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
        <PullRequestList
          prs={prs}
          isLoading={isLoading}
          onViewImpact={(prNumber) => setDetailPr({ projectId, prNumber })}
          onAnalyze={handleAnalyze}
          analyzingPrs={analyzingPrs}
        />
      )}

      {!isValidProject && (
        <div className="text-center text-muted-foreground text-sm py-12">
          Select a project to view its pull requests.
        </div>
      )}

      {detailPr && (
        <PullRequestDetail
          projectId={detailPr.projectId}
          prNumber={detailPr.prNumber}
          open={!!detailPr}
          onClose={() => setDetailPr(null)}
        />
      )}
    </div>
  );
}
