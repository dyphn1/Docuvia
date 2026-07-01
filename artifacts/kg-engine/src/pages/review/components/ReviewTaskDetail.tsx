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

const entityIcons = {
  l1_tag: Tag,
  l2_node: GitMerge,
  l3_node: Network,
};

const nodeTypeBadgeColors: Record<string, string> = {
  module: "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400",
  package: "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400",
  pcd: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  change: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  rule: "bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400",
  decision: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400",
  context: "bg-sky-500/10 border-sky-500/20 text-sky-600 dark:text-sky-400",
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
    onResolve(task.id, "approved", correction !== task.nodeContent ? correction : undefined);
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
              className={`text-[10px] px-1.5 py-0 ${nodeTypeBadgeColors[task.nodeType] ?? ""}`}
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
            {format(new Date(task.createdAt), "MMM d HH:mm")}
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
              {task.description ?? "No description provided."}
            </p>

            {expanded && task.nodeContent && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                    Node Content
                  </Label>
                  {task.status === "pending" && (
                    <button
                      onClick={() => setEditMode((e) => !e)}
                      className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 font-medium"
                    >
                      <Edit3 className="h-2.5 w-2.5" />
                      {editMode ? "Cancel Edit" : "Edit & Correct"}
                    </button>
                  )}
                </div>
                {editMode ? (
                  <Textarea
                    value={correction}
                    onChange={(e) => setCorrection(e.target.value)}
                    className="text-xs font-mono min-h-24 resize-none bg-background border-primary/30 focus:border-primary"
                    placeholder="Enter corrected content..."
                  />
                ) : (
                  <pre className="text-xs font-mono bg-muted/40 p-2.5 rounded-md border border-border/50 whitespace-pre-wrap text-foreground/90 max-h-48 overflow-y-auto">
                    {task.nodeContent}
                  </pre>
                )}
              </div>
            )}

            {task.correctedValue && task.status !== "pending" && (
              <div className="mt-3 space-y-1">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                  Human Correction
                </Label>
                <pre className="text-xs font-mono bg-emerald-500/5 border border-emerald-500/20 p-2.5 rounded-md text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap">
                  {task.correctedValue}
                </pre>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      {task.status === "pending" && (
        <CardFooter className="p-3 bg-muted/10 border-t border-border flex justify-between items-center">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            {expanded ? "Hide" : "Show"} content
          </button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onResolve(task.id, "deferred")}
              className="h-7 text-xs border-border"
            >
              <Clock className="h-3 w-3 mr-1" /> Defer
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onResolve(task.id, "rejected")}
              className="h-7 text-xs bg-destructive/90"
            >
              <X className="h-3 w-3 mr-1" /> Reject
            </Button>
            {editMode ? (
              <Button
                size="sm"
                onClick={handleApproveWithCorrection}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Check className="h-3 w-3 mr-1" /> Save & Approve
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => onResolve(task.id, "approved")}
                className="h-7 text-xs"
              >
                <Check className="h-3 w-3 mr-1" /> Approve
              </Button>
            )}
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
