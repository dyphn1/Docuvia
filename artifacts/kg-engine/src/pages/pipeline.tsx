import { useState } from "react";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { GitBranch, Zap, CheckCircle2, AlertCircle, Loader2, Upload, Database, Cpu } from "lucide-react";

interface IngestResult {
  commitsIngested: number;
  commitsSkipped: number;
  totalFetched: number;
}

interface GenerateResult {
  l1TagsCreated: number;
  l2NodesCreated: number;
  l3NodesCreated: number;
  reviewTasksCreated: number;
  commitsProcessed: number;
}

export default function Pipeline() {
  const queryClient = useQueryClient();
  const { data: projects } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });

  const [selectedProject, setSelectedProject] = useState<string>("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [limit, setLimit] = useState("100");
  const [githubToken, setGithubToken] = useState("");
  const [model, setModel] = useState("gpt-5.2");
  const [maxCommits, setMaxCommits] = useState("50");

  const [ingestLoading, setIngestLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const selectedProj = projects?.find(p => String(p.id) === selectedProject);

  const handleIngest = async () => {
    if (!selectedProject) return;
    setIngestLoading(true);
    setIngestError(null);
    setIngestResult(null);
    try {
      const res = await fetch(`/api/projects/${selectedProject}/ingest/git`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: repoUrl || undefined,
          branch,
          limit: Number(limit),
          githubToken: githubToken || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Ingest failed");
      }
      const data = await res.json();
      setIngestResult(data);
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIngestLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedProject) return;
    setGenerateLoading(true);
    setGenerateError(null);
    setGenerateResult(null);
    try {
      const res = await fetch(`/api/projects/${selectedProject}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, maxCommits: Number(maxCommits) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Generation failed");
      }
      const data = await res.json();
      setGenerateResult(data);
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerateLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-8 max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ingest & Generate Pipeline</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Phase 2 &amp; 3 — Pull commits from VCS, then run the AI knowledge construction pipeline
        </p>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Select Project
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a project..." />
            </SelectTrigger>
            <SelectContent>
              {projects?.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name} — {p.repoUrl}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedProj && (
            <div className="mt-3 flex gap-3 text-xs text-muted-foreground font-mono">
              <span>{selectedProj.commitCount} commits</span>
              <span>·</span>
              <span>{selectedProj.l2Count} L2 nodes</span>
              <span>·</span>
              <span>{selectedProj.l3Count} L3 nodes</span>
              <span>·</span>
              <Badge variant={selectedProj.status === 'active' ? 'default' : selectedProj.status === 'indexing' ? 'secondary' : 'destructive'} className="text-[10px] uppercase h-4">
                {selectedProj.status}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                onChange={e => setRepoUrl(e.target.value)}
                className="font-mono text-xs h-8"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Branch</Label>
                <Input value={branch} onChange={e => setBranch(e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Commit Limit</Label>
                <Input value={limit} onChange={e => setLimit(e.target.value)} type="number" className="text-xs h-8" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">GitHub Token (optional, for private repos)</Label>
              <Input
                type="password"
                placeholder="ghp_..."
                value={githubToken}
                onChange={e => setGithubToken(e.target.value)}
                className="font-mono text-xs h-8"
              />
            </div>
            <Button
              className="w-full"
              size="sm"
              onClick={handleIngest}
              disabled={!selectedProject || ingestLoading}
            >
              {ingestLoading ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" />Fetching commits...</> : <><Upload className="h-3 w-3 mr-2" />Ingest from GitHub</>}
            </Button>

            {ingestResult && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Ingest Complete
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="text-center">
                    <div className="text-lg font-bold font-mono text-foreground">{ingestResult.commitsIngested}</div>
                    <div className="text-[10px] text-muted-foreground">Ingested</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold font-mono text-foreground">{ingestResult.commitsSkipped}</div>
                    <div className="text-[10px] text-muted-foreground">Skipped</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold font-mono text-foreground">{ingestResult.totalFetched}</div>
                    <div className="text-[10px] text-muted-foreground">Total</div>
                  </div>
                </div>
              </div>
            )}
            {ingestError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{ingestError}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              Phase 3 — AI Knowledge Generation
            </CardTitle>
            <CardDescription className="text-xs">
              Run L1 Tagger → L2 Extractor → L3 Generator pipeline on filtered commits.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-2.5 bg-muted/40 rounded-md text-xs text-muted-foreground space-y-1 font-mono border border-border/50">
              <div className="flex items-center gap-1.5"><span className="text-primary">1.</span> Filter commits by signal score (≥0.4)</div>
              <div className="flex items-center gap-1.5"><span className="text-primary">2.</span> L1 Tagger — generate global classification tags</div>
              <div className="flex items-center gap-1.5"><span className="text-primary">3.</span> L2 Extractor — extract modules &amp; packages</div>
              <div className="flex items-center gap-1.5"><span className="text-primary">4.</span> L3 Generator — rules, decisions &amp; rationale</div>
              <div className="flex items-center gap-1.5"><span className="text-primary">5.</span> Queue review tasks for human validation</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Model</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-5.2">gpt-5.2 (recommended)</SelectItem>
                    <SelectItem value="gpt-5.4">gpt-5.4 (most capable)</SelectItem>
                    <SelectItem value="gpt-5-mini">gpt-5-mini (fast)</SelectItem>
                    <SelectItem value="gpt-5-nano">gpt-5-nano (cheapest)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Commits</Label>
                <Input value={maxCommits} onChange={e => setMaxCommits(e.target.value)} type="number" className="text-xs h-8" />
              </div>
            </div>
            <Button
              className="w-full"
              size="sm"
              onClick={handleGenerate}
              disabled={!selectedProject || generateLoading}
            >
              {generateLoading ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" />Running pipeline...</> : <><Zap className="h-3 w-3 mr-2" />Run AI Pipeline</>}
            </Button>

            {generateResult && (
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-md space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Pipeline Complete
                </div>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div className="text-center p-1.5 bg-background rounded border border-border/50">
                    <div className="text-base font-bold font-mono">{generateResult.l1TagsCreated}</div>
                    <div className="text-[10px] text-muted-foreground">L1 Tags</div>
                  </div>
                  <div className="text-center p-1.5 bg-background rounded border border-border/50">
                    <div className="text-base font-bold font-mono">{generateResult.l2NodesCreated}</div>
                    <div className="text-[10px] text-muted-foreground">L2 Nodes</div>
                  </div>
                  <div className="text-center p-1.5 bg-background rounded border border-border/50">
                    <div className="text-base font-bold font-mono">{generateResult.l3NodesCreated}</div>
                    <div className="text-[10px] text-muted-foreground">L3 Nodes</div>
                  </div>
                  <div className="text-center p-1.5 bg-background rounded border border-border/50">
                    <div className="text-base font-bold font-mono">{generateResult.reviewTasksCreated}</div>
                    <div className="text-[10px] text-muted-foreground">Review Tasks</div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground text-center">
                  {generateResult.commitsProcessed} commits processed → go to Review Queue
                </div>
              </div>
            )}
            {generateError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{generateError}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
