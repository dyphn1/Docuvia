import { useState } from "react";
import { useGenerateKnowledge, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Zap, CheckCircle2, AlertCircle, Loader2, Cpu } from "lucide-react";

interface GenerateResult {
  l1TagsCreated: number;
  l2NodesCreated: number;
  l2NodesUpdated: number;
  l3NodesCreated: number;
  reviewTasksCreated: number;
  commitsProcessed: number;
  documentsUsed: number;
}

interface GenerateCardProps {
  selectedProject: string;
}

export function GenerateCard({ selectedProject }: GenerateCardProps) {
  const queryClient = useQueryClient();

  const [model, setModel] = useState("gpt-5.2");
  const [maxCommits, setMaxCommits] = useState("50");
  const [generateMode, setGenerateMode] = useState<"full" | "incremental">("full");

  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const generateKnowledgeMutation = useGenerateKnowledge();

  const handleGenerate = () => {
    if (!selectedProject) return;
    setGenerateLoading(true);
    setGenerateError(null);
    setGenerateResult(null);

    generateKnowledgeMutation.mutate(
      {
        id: Number(selectedProject),
        data: {
          model,
          maxCommits: Number(maxCommits),
          mode: generateMode as any,
        },
      },
      {
        onSuccess: (data) => {
          setGenerateResult(data as unknown as GenerateResult);
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setGenerateLoading(false);
        },
        onError: (e) => {
          setGenerateError(e.message || "Generation failed");
          setGenerateLoading(false);
        },
      }
    );
  };

  return (
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
          <div className="flex items-center gap-1.5">
            <span className="text-primary">1.</span> Filter commits by signal score (≥0.4)
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-primary">2.</span> L1 Tagger — generate global classification tags
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-primary">3.</span> L2 Extractor — extract modules &amp; packages
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-primary">4.</span> L3 Generator — rules, decisions &amp; rationale
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-primary">5.</span> Queue review tasks for human validation
          </div>
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
            <Input
              value={maxCommits}
              onChange={(e) => setMaxCommits(e.target.value)}
              type="number"
              className="text-xs h-8"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Generation Mode</Label>
          <Select
            value={generateMode}
            onValueChange={(v) => setGenerateMode(v as "full" | "incremental")}
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
          onClick={handleGenerate}
          disabled={!selectedProject || generateLoading}
        >
          {generateLoading ? (
            <>
              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              Running pipeline...
            </>
          ) : (
            <>
              <Zap className="h-3 w-3 mr-2" />
              Run AI Pipeline
            </>
          )}
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
                <div className="text-base font-bold font-mono">
                  {generateResult.l2NodesCreated}
                  {(generateResult.l2NodesUpdated ?? 0) > 0 && (
                    <span className="text-[9px] text-amber-500 ml-1">
                      +{generateResult.l2NodesUpdated} upd
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">L2 Nodes</div>
              </div>
              <div className="text-center p-1.5 bg-background rounded border border-border/50">
                <div className="text-base font-bold font-mono">{generateResult.l3NodesCreated}</div>
                <div className="text-[10px] text-muted-foreground">L3 Nodes</div>
              </div>
              <div className="text-center p-1.5 bg-background rounded border border-border/50">
                <div className="text-base font-bold font-mono">
                  {generateResult.reviewTasksCreated}
                </div>
                <div className="text-[10px] text-muted-foreground">Review Tasks</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground text-center space-y-0.5">
              <div>{generateResult.commitsProcessed} commits processed → go to Review Queue</div>
              {(generateResult.documentsUsed ?? 0) > 0 && (
                <div className="text-emerald-600 dark:text-emerald-400">
                  {generateResult.documentsUsed} docs used as context
                </div>
              )}
            </div>
          </div>
        )}
        {generateError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {generateError}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
