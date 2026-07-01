import { useState } from "react";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Database } from "lucide-react";
import { normalizeProjects } from "@/lib/projects";
import { IngestCard } from "./pipeline/components/IngestCard";
import { GenerateCard } from "./pipeline/components/GenerateCard";

export default function Pipeline() {
  const { data: projectsData } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = normalizeProjects(projectsData);

  const [selectedProject, setSelectedProject] = useState<string>("");

  const selectedProj = projects.find((p) => String(p.id) === selectedProject);

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
              {projects.map((p) => (
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
              <Badge
                variant={
                  selectedProj.status === "active"
                    ? "default"
                    : selectedProj.status === "indexing"
                      ? "secondary"
                      : "destructive"
                }
                className="text-[10px] uppercase h-4"
              >
                {selectedProj.status}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <IngestCard selectedProject={selectedProject} selectedProj={selectedProj} />
        <GenerateCard selectedProject={selectedProject} />
      </div>
    </div>
  );
}
