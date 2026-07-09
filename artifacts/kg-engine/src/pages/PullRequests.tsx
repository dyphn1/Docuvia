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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { normalizeProjects } from "@/lib/projects";
import { PullRequestList } from "./pull-requests/components/PullRequestList";
import { PullRequestDetail } from "./pull-requests/components/PullRequestDetail";
import {
  PR_LIST_REFETCH_INTERVAL_MS,
  GITHUB_WEBHOOK_PATH_PREFIX,
  GITHUB_WEBHOOK_PATH_PLACEHOLDER,
  GITHUB_WEBHOOK_SECRET_ENV_VAR_NAME,
  GITHUB_WEBHOOK_CONTENT_TYPE,
  GITHUB_WEBHOOK_EVENT_NAME,
  PR_PAGE_TITLE,
  PR_PAGE_SUBTITLE,
  PR_PROJECT_SELECT_PLACEHOLDER,
  PR_REFRESH_BUTTON_LABEL,
  PR_WEBHOOK_CARD_TITLE,
  PR_WEBHOOK_CARD_DESCRIPTION,
  PR_WEBHOOK_PAYLOAD_URL_LABEL,
  PR_WEBHOOK_CONTENT_TYPE_LABEL,
  PR_WEBHOOK_SECRET_LABEL,
  PR_WEBHOOK_SECRET_HELPER_TEXT,
  PR_WEBHOOK_SECRET_HELPER_SUFFIX,
  PR_WEBHOOK_EVENTS_LABEL,
  PR_NO_PROJECT_SELECTED_MESSAGE,
} from "@/constants/pull-requests";

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
      refetchInterval: PR_LIST_REFETCH_INTERVAL_MS,
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
    ? `${window.location.origin}${GITHUB_WEBHOOK_PATH_PREFIX}/${projectId}`
    : GITHUB_WEBHOOK_PATH_PLACEHOLDER;

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{PR_PAGE_TITLE}</h1>
        <p className="text-muted-foreground text-sm mt-1">{PR_PAGE_SUBTITLE}</p>
      </div>

      {/* Project selector */}
      <div className="flex items-center gap-3">
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={PR_PROJECT_SELECT_PLACEHOLDER} />
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
            <RefreshCw className="h-3 w-3 mr-1" /> {PR_REFRESH_BUTTON_LABEL}
          </Button>
        )}
      </div>

      {/* Webhook setup card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{PR_WEBHOOK_CARD_TITLE}</CardTitle>
          <CardDescription>{PR_WEBHOOK_CARD_DESCRIPTION}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">{PR_WEBHOOK_PAYLOAD_URL_LABEL}</span>
            <code className="ml-2 text-xs bg-muted px-2 py-1 rounded font-mono break-all">
              {webhookEndpoint}
            </code>
          </div>
          <div>
            <span className="text-muted-foreground">{PR_WEBHOOK_CONTENT_TYPE_LABEL}</span>
            <code className="ml-2 text-xs bg-muted px-2 py-1 rounded font-mono">
              {GITHUB_WEBHOOK_CONTENT_TYPE}
            </code>
          </div>
          <div>
            <span className="text-muted-foreground">{PR_WEBHOOK_SECRET_LABEL}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {PR_WEBHOOK_SECRET_HELPER_TEXT}{" "}
              <code className="bg-muted px-1 rounded">{GITHUB_WEBHOOK_SECRET_ENV_VAR_NAME}</code>{" "}
              {PR_WEBHOOK_SECRET_HELPER_SUFFIX}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">{PR_WEBHOOK_EVENTS_LABEL}</span>
            <Badge variant="outline" className="ml-2 text-xs">
              {GITHUB_WEBHOOK_EVENT_NAME}
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
          {PR_NO_PROJECT_SELECTED_MESSAGE}
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
