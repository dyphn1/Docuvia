import { useState } from "react";
import {
  useUpsertProjectTemplate,
  useDeleteProjectTemplate,
  type PromptTemplateTemplateType,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/hooks/use-toast";
import { FileCode, RotateCcw, Save, ChevronDown } from "lucide-react";
import {
  MIN_PROMPT_LENGTH,
  TEMPLATE_META,
  TEMPLATE_SAVED_TOAST_TITLE,
  TEMPLATE_SAVED_TOAST_DESCRIPTION,
  TEMPLATE_SAVE_FAILED_TOAST_TITLE,
  TEMPLATE_SAVE_FAILED_TOAST_DESCRIPTION,
  TEMPLATE_RESET_TOAST_TITLE,
  TEMPLATE_RESET_TOAST_DESCRIPTION,
  TEMPLATE_RESET_FAILED_TOAST_TITLE,
  TEMPLATE_RESET_FAILED_TOAST_DESCRIPTION,
  TEMPLATE_CUSTOM_BADGE_LABEL,
  TEMPLATE_DEFAULT_BADGE_LABEL,
  TEMPLATE_UPDATED_LABEL_PREFIX,
  TEMPLATE_RESET_TITLE_ATTR,
  TEMPLATE_RESET_BUTTON_LABEL,
  TEMPLATE_EDIT_BUTTON_LABEL,
  TEMPLATE_CANCEL_BUTTON_LABEL,
  TEMPLATE_PROMPT_PLACEHOLDER,
  TEMPLATE_SAVING_LABEL,
  TEMPLATE_SAVE_BUTTON_LABEL,
} from "@/constants/templates";

export function TemplateEditor({
  projectId,
  template,
}: {
  projectId: number;
  template: {
    templateType: PromptTemplateTemplateType;
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
        toast({
          title: TEMPLATE_SAVED_TOAST_TITLE,
          description: TEMPLATE_SAVED_TOAST_DESCRIPTION,
        });
        setEditing(false);
      },
      onError: () => {
        toast({
          title: TEMPLATE_SAVE_FAILED_TOAST_TITLE,
          description: TEMPLATE_SAVE_FAILED_TOAST_DESCRIPTION,
          variant: "destructive",
        });
      },
    },
  });

  const reset = useDeleteProjectTemplate({
    mutation: {
      onSuccess: () => {
        toast({
          title: TEMPLATE_RESET_TOAST_TITLE,
          description: TEMPLATE_RESET_TOAST_DESCRIPTION,
        });
        setEditing(false);
      },
      onError: () => {
        toast({
          title: TEMPLATE_RESET_FAILED_TOAST_TITLE,
          description: TEMPLATE_RESET_FAILED_TOAST_DESCRIPTION,
          variant: "destructive",
        });
      },
    },
  });

  const meta = TEMPLATE_META[template.templateType];

  const handleSave = () => {
    upsert.mutate({
      id: projectId,
      type: template.templateType,
      data: { systemPrompt: draft },
    });
  };

  const handleReset = () => {
    reset.mutate({
      id: projectId,
      type: template.templateType,
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
              {template.isCustom ? TEMPLATE_CUSTOM_BADGE_LABEL : TEMPLATE_DEFAULT_BADGE_LABEL}
            </Badge>
            {template.updatedAt && template.isCustom && (
              <span className="text-[10px] text-muted-foreground">
                {TEMPLATE_UPDATED_LABEL_PREFIX} {new Date(template.updatedAt).toLocaleDateString()}
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
              title={TEMPLATE_RESET_TITLE_ATTR}
            >
              <RotateCcw className="h-3 w-3" />
              {TEMPLATE_RESET_BUTTON_LABEL}
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
            {editing ? TEMPLATE_CANCEL_BUTTON_LABEL : TEMPLATE_EDIT_BUTTON_LABEL}
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
            placeholder={TEMPLATE_PROMPT_PLACEHOLDER}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {TEMPLATE_CANCEL_BUTTON_LABEL}
            </button>
            <button
              onClick={handleSave}
              disabled={upsert.isPending || draft.trim().length < MIN_PROMPT_LENGTH}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              {upsert.isPending ? TEMPLATE_SAVING_LABEL : TEMPLATE_SAVE_BUTTON_LABEL}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
