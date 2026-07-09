import { useState } from "react";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Database } from "lucide-react";
import { normalizeProjects } from "@/lib/projects";
import { IngestCard } from "./pipeline/components/IngestCard";
import { GenerateCard } from "./pipeline/components/GenerateCard";
import {
  PROJECT_STATUS_BADGE_VARIANT,
  PIPELINE_PAGE_TITLE,
  PIPELINE_PAGE_DESCRIPTION,
  PIPELINE_SELECT_PROJECT_CARD_TITLE,
  PIPELINE_SELECT_PROJECT_PLACEHOLDER,
  PIPELINE_COMMITS_SUFFIX_LABEL,
  PIPELINE_L2_NODES_SUFFIX_LABEL,
  PIPELINE_L3_NODES_SUFFIX_LABEL,
} from "@/constants/pipeline";

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
        <h1 className="text-2xl font-bold tracking-tight">{PIPELINE_PAGE_TITLE}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{PIPELINE_PAGE_DESCRIPTION}</p>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            {PIPELINE_SELECT_PROJECT_CARD_TITLE}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger>
              <SelectValue placeholder={PIPELINE_SELECT_PROJECT_PLACEHOLDER} />
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
              <span>
                {selectedProj.commitCount} {PIPELINE_COMMITS_SUFFIX_LABEL}
              </span>
              <span>·</span>
              <span>
                {selectedProj.l2Count} {PIPELINE_L2_NODES_SUFFIX_LABEL}
              </span>
              <span>·</span>
              <span>
                {selectedProj.l3Count} {PIPELINE_L3_NODES_SUFFIX_LABEL}
              </span>
              <span>·</span>
              <Badge
                variant={PROJECT_STATUS_BADGE_VARIANT[selectedProj.status] ?? "destructive"}
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
