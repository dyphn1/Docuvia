import { useState } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { FileCode } from "lucide-react";
import { normalizeProjects } from "@/lib/projects";
import { ProjectTemplates } from "./templates/ProjectTemplates";

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
