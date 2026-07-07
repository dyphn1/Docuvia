import { useState } from "react";
import { useUpsertProjectTemplate, useDeleteProjectTemplate } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/hooks/use-toast";
import { FileCode, RotateCcw, Save, ChevronDown } from "lucide-react";

export const TEMPLATE_META = {
  l1_tagger: {
    label: "L1 Tagger",
    description:
      "System prompt for extracting high-level domain classification tags from commit messages.",
    color: "border-blue-500/40 text-blue-400",
  },
  l2_extractor: {
    label: "L2 Extractor",
    description:
      "System prompt for identifying software components, modules, and packages from commit history.",
    color: "border-purple-500/40 text-purple-400",
  },
  l3_generator: {
    label: "L3 Generator",
    description:
      "System prompt for generating implementation rules, technical decisions, and rationale.",
    color: "border-green-500/40 text-green-400",
  },
};

export function TemplateEditor({
  projectId,
  template,
}: {
  projectId: number;
  template: {
    templateType: string;
    systemPrompt: string;
    isCustom: boolean;
    isActive: boolean;
    id?: number | null;
    updatedAt?: string | null;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(template.systemPrompt);
  const { toast } = useToast();

  const upsert = useUpsertProjectTemplate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template saved", description: "Prompt template updated successfully." });
        setEditing(false);
      },
      onError: () => {
        toast({
          title: "Save failed",
          description: "Failed to update the template.",
          variant: "destructive",
        });
      },
    },
  });

  const reset = useDeleteProjectTemplate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template reset", description: "Reverted to the global default prompt." });
        setEditing(false);
      },
      onError: () => {
        toast({
          title: "Reset failed",
          description: "Failed to reset the template.",
          variant: "destructive",
        });
      },
    },
  });

  const meta = TEMPLATE_META[template.templateType as keyof typeof TEMPLATE_META];

  const handleSave = () => {
    upsert.mutate({
      id: projectId,
      type: template.templateType as "l1_tagger" | "l2_extractor" | "l3_generator",
      data: { systemPrompt: draft },
    });
  };

  const handleReset = () => {
    reset.mutate({
      id: projectId,
      type: template.templateType as "l1_tagger" | "l2_extractor" | "l3_generator",
    });
  };

  return (
    <div className="border border-border rounded-md bg-background overflow-hidden">
      <div className="p-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-foreground">
              {meta?.label ?? template.templateType}
            </span>
            <Badge variant="outline" className={`text-[9px] uppercase ${meta?.color ?? ""}`}>
              {template.isCustom ? "Custom" : "Default"}
            </Badge>
            {template.updatedAt && template.isCustom && (
              <span className="text-[10px] text-muted-foreground">
                Updated {new Date(template.updatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
          {meta?.description && (
            <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {template.isCustom && (
            <button
              onClick={handleReset}
              disabled={reset.isPending}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground border border-border hover:border-border/80 transition-colors disabled:opacity-50"
              title="Reset to global default"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
          <button
            onClick={() => {
              setDraft(template.systemPrompt);
              setEditing((v) => !v);
            }}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
          >
            <FileCode className="h-3 w-3" />
            {editing ? "Cancel" : "Edit"}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${editing ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      {!editing && (
        <div className="px-4 pb-4">
          <pre className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-32 overflow-y-auto">
            {template.systemPrompt}
          </pre>
        </div>
      )}

      {editing && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            className="w-full text-xs font-mono bg-muted/40 border border-border rounded-md p-3 focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y text-foreground placeholder:text-muted-foreground leading-relaxed"
            placeholder="Enter your custom system prompt..."
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={upsert.isPending || draft.trim().length < 10}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              {upsert.isPending ? "Saving..." : "Save Template"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
