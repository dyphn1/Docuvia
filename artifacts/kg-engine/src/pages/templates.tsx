import { useState } from "react";
import {
  useListProjects,
  useListProjectTemplates,
  getListProjectTemplatesQueryKey,
  useUpsertProjectTemplate,
  useDeleteProjectTemplate,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileCode, RotateCcw, Save, ChevronDown } from "lucide-react";
import { normalizeProjects } from "@/lib/projects";

const TEMPLATE_META = {
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

function TemplateEditor({
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

function ProjectTemplates({ projectId, projectName }: { projectId: number; projectName: string }) {
  const { data: templates, isLoading } = useListProjectTemplates(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectTemplatesQueryKey(projectId) },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">
        {projectName}
      </h2>
      {(templates ?? []).map((t) => (
        <TemplateEditor key={t.templateType} projectId={projectId} template={t} />
      ))}
    </div>
  );
}

export default function TemplatesPage() {
  const { data: projectsData, isLoading: isLoadingProjects } = useListProjects();
  const projects = normalizeProjects(projectsData);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const selectedProject =
    selectedProjectId != null ? projects.find((p) => p.id === selectedProjectId) : null;

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex-none p-6 border-b border-border bg-card/30">
        <h1 className="text-2xl font-bold tracking-tight">Prompt Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the AI system prompts used during knowledge graph generation for each project.
          Edits override the global default and are used on the next generation run.
        </p>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Project selector sidebar */}
        <aside className="w-56 flex-shrink-0 border-r border-border bg-card/20">
          <div className="p-3 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Projects
            </span>
          </div>
          <ScrollArea className="h-full">
            {isLoadingProjects ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProjectId(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedProjectId === p.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
                {projects.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3">No projects found.</p>
                )}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* Template editor main area */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedProjectId && selectedProject ? (
            <ProjectTemplates projectId={selectedProjectId} projectName={selectedProject.name} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <FileCode className="h-12 w-12 opacity-20" />
              <p className="text-sm">Select a project to manage its prompt templates.</p>
              <p className="text-xs">
                Each template controls how AI generates L1 tags, L2 components, and L3 knowledge
                nodes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
