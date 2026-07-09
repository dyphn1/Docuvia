import { useState } from "react";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import {
  AlertTriangle,
  GitMerge,
  Check,
  X,
  Edit3,
  ChevronDown,
  ChevronUp,
  Tag,
  Network,
  Layers,
  Clock,
} from "lucide-react";
import { format } from "date-fns";
import {
  REVIEW_TASK_DATE_FORMAT,
  REVIEW_TASK_STATUS_PENDING,
  REVIEW_TASK_STATUS_APPROVED,
  REVIEW_TASK_STATUS_REJECTED,
  REVIEW_TASK_STATUS_DEFERRED,
  REVIEW_NODE_TYPE_BADGE_COLORS,
  REVIEW_NO_DESCRIPTION_TEXT,
  REVIEW_NODE_CONTENT_LABEL,
  REVIEW_EDIT_CORRECT_LABEL,
  REVIEW_CANCEL_EDIT_LABEL,
  REVIEW_CORRECTION_PLACEHOLDER,
  REVIEW_HUMAN_CORRECTION_LABEL,
  REVIEW_SHOW_CONTENT_LABEL,
  REVIEW_HIDE_CONTENT_LABEL,
  REVIEW_CONTENT_TOGGLE_SUFFIX,
  REVIEW_DEFER_BUTTON_LABEL,
  REVIEW_REJECT_BUTTON_LABEL,
  REVIEW_SAVE_APPROVE_BUTTON_LABEL,
  REVIEW_APPROVE_BUTTON_LABEL,
} from "@/constants/review";

// Icons are React components, not literal data, so this mapping stays local.
const entityIcons = {
  l1_tag: Tag,
  l2_node: GitMerge,
  l3_node: Network,
};

export interface ReviewTaskDetailProps {
  task: {
    id: number;
    entityType: string;
    entityId: number;
    entityName?: string | null;
    taskType: string;
    status: string;
    description?: string | null;
    nodeContent?: string | null;
    nodeType?: string | null;
    projectName?: string | null;
    correctedValue?: string | null;
    createdAt: string;
    resolvedAt?: string | null;
  };
  onResolve: (
    id: number,
    status: "approved" | "rejected" | "deferred",
    correctedValue?: string
  ) => void;
}

export function ReviewTaskDetail({ task, onResolve }: ReviewTaskDetailProps) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [correction, setCorrection] = useState(task.nodeContent ?? "");

  const Icon = entityIcons[task.entityType as keyof typeof entityIcons] ?? Layers;

  const handleApproveWithCorrection = () => {
    onResolve(
      task.id,
      REVIEW_TASK_STATUS_APPROVED,
      correction !== task.nodeContent ? correction : undefined
    );
    setEditMode(false);
  };

  return (
    <Card className="border-border/80 bg-card shadow-sm hover:border-primary/40 transition-colors overflow-hidden flex flex-col">
      <div className="h-0.5 w-full bg-gradient-to-r from-primary/60 to-transparent" />
      <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary" />
          <Badge
            variant="outline"
            className="font-mono uppercase text-[10px] bg-background px-1.5 py-0"
          >
            {task.entityType.replace("_", " ")}
          </Badge>
          {task.nodeType && (
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${REVIEW_NODE_TYPE_BADGE_COLORS[task.nodeType] ?? ""}`}
            >
              {task.nodeType}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground font-mono">
            {task.taskType.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">
            {format(new Date(task.createdAt), REVIEW_TASK_DATE_FORMAT)}
          </span>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-4 flex-1">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-foreground mb-1">
              {task.entityName ?? `Entity #${task.entityId}`}
            </h4>
            {task.projectName && (
              <div className="text-xs text-muted-foreground mb-2 font-mono">
                Project: {task.projectName}
              </div>
            )}
            <p className="text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-md border border-border/50 font-mono">
              {task.description ?? REVIEW_NO_DESCRIPTION_TEXT}
            </p>

            {expanded && task.nodeContent && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                    {REVIEW_NODE_CONTENT_LABEL}
                  </Label>
                  {task.status === REVIEW_TASK_STATUS_PENDING && (
                    <button
                      onClick={() => setEditMode((e) => !e)}
                      className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 font-medium"
                    >
                      <Edit3 className="h-2.5 w-2.5" />
                      {editMode ? REVIEW_CANCEL_EDIT_LABEL : REVIEW_EDIT_CORRECT_LABEL}
                    </button>
                  )}
                </div>
                {editMode ? (
                  <Textarea
                    value={correction}
                    onChange={(e) => setCorrection(e.target.value)}
                    className="text-xs font-mono min-h-24 resize-none bg-background border-primary/30 focus:border-primary"
                    placeholder={REVIEW_CORRECTION_PLACEHOLDER}
                  />
                ) : (
                  <pre className="text-xs font-mono bg-muted/40 p-2.5 rounded-md border border-border/50 whitespace-pre-wrap text-foreground/90 max-h-48 overflow-y-auto">
                    {task.nodeContent}
                  </pre>
                )}
              </div>
            )}

            {task.correctedValue && task.status !== REVIEW_TASK_STATUS_PENDING && (
              <div className="mt-3 space-y-1">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                  {REVIEW_HUMAN_CORRECTION_LABEL}
                </Label>
                <pre className="text-xs font-mono bg-emerald-500/5 border border-emerald-500/20 p-2.5 rounded-md text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap">
                  {task.correctedValue}
                </pre>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      {task.status === REVIEW_TASK_STATUS_PENDING && (
        <CardFooter className="p-3 bg-muted/10 border-t border-border flex justify-between items-center">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            {expanded ? REVIEW_HIDE_CONTENT_LABEL : REVIEW_SHOW_CONTENT_LABEL}{" "}
            {REVIEW_CONTENT_TOGGLE_SUFFIX}
          </button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onResolve(task.id, REVIEW_TASK_STATUS_DEFERRED)}
              className="h-7 text-xs border-border"
            >
              <Clock className="h-3 w-3 mr-1" /> {REVIEW_DEFER_BUTTON_LABEL}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onResolve(task.id, REVIEW_TASK_STATUS_REJECTED)}
              className="h-7 text-xs bg-destructive/90"
            >
              <X className="h-3 w-3 mr-1" /> {REVIEW_REJECT_BUTTON_LABEL}
            </Button>
            {editMode ? (
              <Button
                size="sm"
                onClick={handleApproveWithCorrection}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Check className="h-3 w-3 mr-1" /> {REVIEW_SAVE_APPROVE_BUTTON_LABEL}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => onResolve(task.id, REVIEW_TASK_STATUS_APPROVED)}
                className="h-7 text-xs"
              >
                <Check className="h-3 w-3 mr-1" /> {REVIEW_APPROVE_BUTTON_LABEL}
              </Button>
            )}
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
