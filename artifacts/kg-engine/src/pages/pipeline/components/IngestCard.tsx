import { useState } from "react";
import { useIngestGit, getListProjectsQueryKey, type Project } from "@workspace/api-client-react";
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

interface IngestResult {
  commitsIngested: number;
  commitsSkipped: number;
  totalFetched: number;
}

interface IngestCardProps {
  selectedProject: string;
  selectedProj?: Project;
}

export function IngestCard({ selectedProject, selectedProj }: IngestCardProps) {
  const queryClient = useQueryClient();

  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [limit, setLimit] = useState("100");
  const [githubToken, setGithubToken] = useState("");
  const [ingestMode, setIngestMode] = useState<"full" | "incremental">("full");

  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
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
          mode: ingestMode as any,
        },
      },
      {
        onSuccess: (data) => {
          setIngestResult(data as unknown as IngestResult);
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setIngestLoading(false);
        },
        onError: (e) => {
          setIngestError(e.message || "Ingest failed");
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
          Phase 2 — Git Ingest
        </CardTitle>
        <CardDescription className="text-xs">
          Fetch commit history from GitHub. Leave URL blank to use project's repo URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Repository URL (optional override)</Label>
          <Input
            placeholder={selectedProj?.repoUrl ?? "https://github.com/owner/repo"}
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            className="font-mono text-xs h-8"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Commit Limit</Label>
            <Input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              type="number"
              className="text-xs h-8"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">GitHub Token (optional, for private repos)</Label>
          <Input
            type="password"
            placeholder="ghp_..."
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            className="font-mono text-xs h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sync Mode</Label>
          <Select
            value={ingestMode}
            onValueChange={(v) => setIngestMode(v as "full" | "incremental")}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full Sync</SelectItem>
              <SelectItem value="incremental">Incremental Sync</SelectItem>
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
              Fetching commits...
            </>
          ) : (
            <>
              <Upload className="h-3 w-3 mr-2" />
              Ingest from GitHub
            </>
          )}
        </Button>

        {ingestResult && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Ingest Complete
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">
                  {ingestResult.commitsIngested}
                </div>
                <div className="text-[10px] text-muted-foreground">Ingested</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">
                  {ingestResult.commitsSkipped}
                </div>
                <div className="text-[10px] text-muted-foreground">Skipped</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">
                  {ingestResult.totalFetched}
                </div>
                <div className="text-[10px] text-muted-foreground">Total</div>
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
