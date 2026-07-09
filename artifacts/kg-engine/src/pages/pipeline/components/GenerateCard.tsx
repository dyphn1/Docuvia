import { useState } from "react";
import {
  useGenerateKnowledge,
  getListProjectsQueryKey,
  GenerateInputMode,
  type GenerateResult,
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
import { Zap, CheckCircle2, AlertCircle, Loader2, Cpu } from "lucide-react";
import {
  MODEL_OPTIONS,
  DEFAULT_MODEL,
  DEFAULT_MAX_COMMITS,
  MIN_SIGNAL_SCORE,
  GENERATE_CARD_TITLE,
  GENERATE_CARD_DESCRIPTION,
  GENERATE_STEP_1_TEXT,
  GENERATE_STEP_2_TEXT,
  GENERATE_STEP_3_TEXT,
  GENERATE_STEP_4_TEXT,
  GENERATE_STEP_5_TEXT,
  GENERATE_MODEL_FIELD_LABEL,
  GENERATE_MAX_COMMITS_FIELD_LABEL,
  GENERATE_MODE_FIELD_LABEL,
  GENERATE_RUNNING_LABEL,
  GENERATE_RUN_BUTTON_LABEL,
  GENERATE_COMPLETE_LABEL,
  GENERATE_L1_TAGS_LABEL,
  GENERATE_L2_NODES_LABEL,
  GENERATE_L3_NODES_LABEL,
  GENERATE_REVIEW_TASKS_LABEL,
  GENERATE_UPDATED_SUFFIX_LABEL,
  GENERATE_COMMITS_PROCESSED_SUFFIX,
  GENERATE_DOCS_USED_SUFFIX,
  GENERATE_ERROR_FALLBACK,
  SYNC_MODE_FULL_LABEL,
  SYNC_MODE_INCREMENTAL_LABEL,
} from "@/constants/pipeline";

interface GenerateCardProps {
  selectedProject: string;
}

export function GenerateCard({ selectedProject }: GenerateCardProps) {
  const queryClient = useQueryClient();

  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [maxCommits, setMaxCommits] = useState(DEFAULT_MAX_COMMITS);
  const [generateMode, setGenerateMode] = useState<GenerateInputMode>(GenerateInputMode.full);

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
          mode: generateMode,
        },
      },
      {
        onSuccess: (data) => {
          setGenerateResult(data);
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setGenerateLoading(false);
        },
        onError: (e) => {
          setGenerateError(e.message || GENERATE_ERROR_FALLBACK);
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
          {GENERATE_CARD_TITLE}
        </CardTitle>
        <CardDescription className="text-xs">{GENERATE_CARD_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="p-2.5 bg-muted/40 rounded-md text-xs text-muted-foreground space-y-1 font-mono border border-border/50">
          <div className="flex items-center gap-1.5">
            <span className="text-primary">1.</span> {GENERATE_STEP_1_TEXT}
            {MIN_SIGNAL_SCORE})
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-primary">2.</span> {GENERATE_STEP_2_TEXT}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-primary">3.</span> {GENERATE_STEP_3_TEXT}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-primary">4.</span> {GENERATE_STEP_4_TEXT}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-primary">5.</span> {GENERATE_STEP_5_TEXT}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">{GENERATE_MODEL_FIELD_LABEL}</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{GENERATE_MAX_COMMITS_FIELD_LABEL}</Label>
            <Input
              value={maxCommits}
              onChange={(e) => setMaxCommits(e.target.value)}
              type="number"
              className="text-xs h-8"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{GENERATE_MODE_FIELD_LABEL}</Label>
          <Select
            value={generateMode}
            onValueChange={(v) => setGenerateMode(v as GenerateInputMode)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GenerateInputMode.full}>{SYNC_MODE_FULL_LABEL}</SelectItem>
              <SelectItem value={GenerateInputMode.incremental}>
                {SYNC_MODE_INCREMENTAL_LABEL}
              </SelectItem>
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
              {GENERATE_RUNNING_LABEL}
            </>
          ) : (
            <>
              <Zap className="h-3 w-3 mr-2" />
              {GENERATE_RUN_BUTTON_LABEL}
            </>
          )}
        </Button>

        {generateResult && (
          <div className="p-3 bg-primary/10 border border-primary/20 rounded-md space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" /> {GENERATE_COMPLETE_LABEL}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div className="text-center p-1.5 bg-background rounded border border-border/50">
                <div className="text-base font-bold font-mono">{generateResult.l1TagsCreated}</div>
                <div className="text-[10px] text-muted-foreground">{GENERATE_L1_TAGS_LABEL}</div>
              </div>
              <div className="text-center p-1.5 bg-background rounded border border-border/50">
                <div className="text-base font-bold font-mono">
                  {generateResult.l2NodesCreated}
                  {(generateResult.l2NodesUpdated ?? 0) > 0 && (
                    <span className="text-[9px] text-amber-500 ml-1">
                      +{generateResult.l2NodesUpdated} {GENERATE_UPDATED_SUFFIX_LABEL}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">{GENERATE_L2_NODES_LABEL}</div>
              </div>
              <div className="text-center p-1.5 bg-background rounded border border-border/50">
                <div className="text-base font-bold font-mono">{generateResult.l3NodesCreated}</div>
                <div className="text-[10px] text-muted-foreground">{GENERATE_L3_NODES_LABEL}</div>
              </div>
              <div className="text-center p-1.5 bg-background rounded border border-border/50">
                <div className="text-base font-bold font-mono">
                  {generateResult.reviewTasksCreated}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {GENERATE_REVIEW_TASKS_LABEL}
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground text-center space-y-0.5">
              <div>
                {generateResult.commitsProcessed} {GENERATE_COMMITS_PROCESSED_SUFFIX}
              </div>
              {(generateResult.documentsUsed ?? 0) > 0 && (
                <div className="text-emerald-600 dark:text-emerald-400">
                  {generateResult.documentsUsed} {GENERATE_DOCS_USED_SUFFIX}
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
