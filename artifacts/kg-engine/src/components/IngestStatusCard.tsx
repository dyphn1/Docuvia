import {
  useGetProjectIngestStatus,
  getGetProjectIngestStatusQueryKey,
  useIngestGit,
  useIngestSvn,
  useGenerateKnowledge,
  type IngestStatusResponse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { AlertCircle, Cpu, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  VCS_TYPE_GIT,
  INGEST_MODE_INCREMENTAL,
  NEVER_SYNCED_LABEL,
  SVN_REVISION_LABEL_PREFIX,
  INGEST_STATUS_CARD_TITLE,
  INGEST_STATUS_LOAD_ERROR_TEXT,
  VCS_LABEL_GIT,
  VCS_LABEL_SVN,
  INGEST_STATUS_VCS_LABEL,
  INGEST_STATUS_LAST_SYNC_LABEL,
  INGEST_STATUS_PENDING_LABEL,
  INGEST_STATUS_COMMITS_SUFFIX,
  INGEST_STATUS_SYNC_BUTTON_TEXT,
  INGEST_STATUS_GENERATE_BUTTON_TEXT,
} from "@/constants/app";

function getSyncCursorLabel(status: IngestStatusResponse | undefined): string {
  if (!status) return NEVER_SYNCED_LABEL;
  if (status.vcsType === VCS_TYPE_GIT) {
    return status.lastGitIngestedAt
      ? formatDistanceToNow(new Date(status.lastGitIngestedAt), { addSuffix: true })
      : NEVER_SYNCED_LABEL;
  }
  return status.lastSvnRevision != null
    ? `${SVN_REVISION_LABEL_PREFIX}${status.lastSvnRevision}`
    : NEVER_SYNCED_LABEL;
}

interface IngestStatusCardProps {
  projectId: number;
  repoUrl?: string;
}

export function IngestStatusCard({ projectId, repoUrl }: IngestStatusCardProps) {
  const {
    data: status,
    isLoading,
    error,
  } = useGetProjectIngestStatus(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectIngestStatusQueryKey(projectId) },
  });

  const ingestGit = useIngestGit();
  const ingestSvn = useIngestSvn();
  const generateKg = useGenerateKnowledge();

  const handleIncrementalSync = () => {
    if (!status) return;
    if (status.vcsType === VCS_TYPE_GIT) {
      ingestGit.mutate({ id: projectId, data: { mode: INGEST_MODE_INCREMENTAL } });
    } else {
      ingestSvn.mutate({
        id: projectId,
        data: { svnUrl: repoUrl ?? "", mode: INGEST_MODE_INCREMENTAL },
      });
    }
  };

  const handleDeltaGenerate = () => {
    generateKg.mutate({ id: projectId, data: { mode: INGEST_MODE_INCREMENTAL } });
  };

  const isSyncPending = ingestGit.isPending || ingestSvn.isPending;
  const isGeneratePending = generateKg.isPending;

  const cursor = getSyncCursorLabel(status);

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-primary" />
          {INGEST_STATUS_CARD_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-48" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {INGEST_STATUS_LOAD_ERROR_TEXT}
          </div>
        ) : status ? (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{INGEST_STATUS_VCS_LABEL}</span>
                <Badge
                  variant="outline"
                  className={
                    status.vcsType === VCS_TYPE_GIT
                      ? "border-orange-500/40 text-orange-400"
                      : "border-blue-500/40 text-blue-400"
                  }
                >
                  <GitBranch className="h-3 w-3 mr-1" />
                  {status.vcsType === VCS_TYPE_GIT ? VCS_LABEL_GIT : VCS_LABEL_SVN}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {INGEST_STATUS_LAST_SYNC_LABEL}
                </span>
                <span className="text-xs font-mono text-foreground">{cursor}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{INGEST_STATUS_PENDING_LABEL}</span>
                <Badge
                  variant={status.pendingCommits > 0 ? "default" : "secondary"}
                  className={
                    status.pendingCommits > 0
                      ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-400"
                      : ""
                  }
                >
                  {status.pendingCommits} {INGEST_STATUS_COMMITS_SUFFIX}
                </Badge>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={handleIncrementalSync}
                disabled={isSyncPending}
                className="text-xs h-7 gap-1.5"
              >
                {isSyncPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {INGEST_STATUS_SYNC_BUTTON_TEXT}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDeltaGenerate}
                disabled={isGeneratePending}
                className="text-xs h-7 gap-1.5"
              >
                {isGeneratePending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Cpu className="h-3 w-3" />
                )}
                {INGEST_STATUS_GENERATE_BUTTON_TEXT}
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
