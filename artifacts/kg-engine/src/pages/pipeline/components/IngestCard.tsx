import { useState } from "react";
import {
  useIngestGit,
  getListProjectsQueryKey,
  GitIngestInputMode,
  type Project,
  type GitIngestResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { GitBranch, CheckCircle2, AlertCircle, Loader2, Upload } from "lucide-react";
import {
  DEFAULT_BRANCH,
  DEFAULT_COMMIT_LIMIT,
  INGEST_CARD_TITLE,
  INGEST_CARD_DESCRIPTION,
  INGEST_REPO_URL_FIELD_LABEL,
  INGEST_REPO_URL_PLACEHOLDER_FALLBACK,
  INGEST_BRANCH_FIELD_LABEL,
  INGEST_COMMIT_LIMIT_FIELD_LABEL,
  INGEST_GITHUB_TOKEN_FIELD_LABEL,
  INGEST_GITHUB_TOKEN_PLACEHOLDER,
  INGEST_SYNC_MODE_FIELD_LABEL,
  INGEST_FETCHING_LABEL,
  INGEST_BUTTON_LABEL,
  INGEST_COMPLETE_LABEL,
  INGEST_INGESTED_LABEL,
  INGEST_SKIPPED_LABEL,
  INGEST_TOTAL_LABEL,
  INGEST_ERROR_FALLBACK,
  SYNC_MODE_FULL_LABEL,
  SYNC_MODE_INCREMENTAL_LABEL,
} from "@/constants/pipeline";

interface IngestCardProps {
  selectedProject: string;
  selectedProj?: Project;
}

export function IngestCard({ selectedProject, selectedProj }: IngestCardProps) {
  const queryClient = useQueryClient();

  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState(DEFAULT_BRANCH);
  const [limit, setLimit] = useState(DEFAULT_COMMIT_LIMIT);
  const [githubToken, setGithubToken] = useState("");
  const [ingestMode, setIngestMode] = useState<GitIngestInputMode>(GitIngestInputMode.full);

  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState<GitIngestResult | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const ingestGitMutation = useIngestGit();

  const handleIngest = () => {
    if (!selectedProject) return;
    setIngestLoading(true);
    setIngestError(null);
    setIngestResult(null);

    ingestGitMutation.mutate(
      {
        id: Number(selectedProject),
        data: {
          repoUrl: repoUrl || undefined,
          branch,
          limit: Number(limit),
          githubToken: githubToken || undefined,
          mode: ingestMode,
        },
      },
      {
        onSuccess: (data) => {
          setIngestResult(data);
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setIngestLoading(false);
        },
        onError: (e) => {
          setIngestError(e.message || INGEST_ERROR_FALLBACK);
          setIngestLoading(false);
        },
      }
    );
  };

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          {INGEST_CARD_TITLE}
        </CardTitle>
        <CardDescription className="text-xs">{INGEST_CARD_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">{INGEST_REPO_URL_FIELD_LABEL}</Label>
          <Input
            placeholder={selectedProj?.repoUrl ?? INGEST_REPO_URL_PLACEHOLDER_FALLBACK}
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            className="font-mono text-xs h-8"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">{INGEST_BRANCH_FIELD_LABEL}</Label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{INGEST_COMMIT_LIMIT_FIELD_LABEL}</Label>
            <Input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              type="number"
              className="text-xs h-8"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{INGEST_GITHUB_TOKEN_FIELD_LABEL}</Label>
          <Input
            type="password"
            placeholder={INGEST_GITHUB_TOKEN_PLACEHOLDER}
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            className="font-mono text-xs h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{INGEST_SYNC_MODE_FIELD_LABEL}</Label>
          <Select value={ingestMode} onValueChange={(v) => setIngestMode(v as GitIngestInputMode)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GitIngestInputMode.full}>{SYNC_MODE_FULL_LABEL}</SelectItem>
              <SelectItem value={GitIngestInputMode.incremental}>
                {SYNC_MODE_INCREMENTAL_LABEL}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          className="w-full"
          size="sm"
          onClick={handleIngest}
          disabled={!selectedProject || ingestLoading}
        >
          {ingestLoading ? (
            <>
              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              {INGEST_FETCHING_LABEL}
            </>
          ) : (
            <>
              <Upload className="h-3 w-3 mr-2" />
              {INGEST_BUTTON_LABEL}
            </>
          )}
        </Button>

        {ingestResult && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> {INGEST_COMPLETE_LABEL}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">
                  {ingestResult.commitsIngested}
                </div>
                <div className="text-[10px] text-muted-foreground">{INGEST_INGESTED_LABEL}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">
                  {ingestResult.commitsSkipped}
                </div>
                <div className="text-[10px] text-muted-foreground">{INGEST_SKIPPED_LABEL}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">
                  {ingestResult.totalFetched}
                </div>
                <div className="text-[10px] text-muted-foreground">{INGEST_TOTAL_LABEL}</div>
              </div>
            </div>
          </div>
        )}
        {ingestError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {ingestError}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
