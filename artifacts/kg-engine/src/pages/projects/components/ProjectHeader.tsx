import { format } from "date-fns";
import { Terminal } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IngestStatusCard } from "@/components/IngestStatusCard";
import type { Project } from "@workspace/api-client-react";
import {
  PROJECT_STATUS_ACTIVE,
  PROJECT_DATE_FORMAT,
  CREATED_LABEL_PREFIX,
  EXPORTING_LABEL,
  EXPORT_MARKDOWN_LABEL,
  L2_NODES_LABEL,
  L3_NODES_LABEL,
} from "@/constants/projects";

interface ProjectHeaderProps {
  project: Project;
  projectId: number;
  isExporting: boolean;
  onExport: () => void;
}

export function ProjectHeader({ project, projectId, isExporting, onExport }: ProjectHeaderProps) {
  return (
    <div className="flex-none p-6 border-b border-border bg-card/30">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <Badge
              variant={project.status === PROJECT_STATUS_ACTIVE ? "default" : "secondary"}
              className="font-mono uppercase text-[10px]"
            >
              {project.status}
            </Badge>
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Terminal className="h-3 w-3" /> {project.repoUrl}
            </span>
            <span>
              {CREATED_LABEL_PREFIX} {format(new Date(project.createdAt), PROJECT_DATE_FORMAT)}
            </span>
          </div>
          {project.description && <p className="mt-4 text-sm max-w-3xl">{project.description}</p>}
          <div className="mt-4 max-w-xl">
            <IngestStatusCard projectId={projectId} repoUrl={project.repoUrl} />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col gap-2 justify-center">
            <Button variant="outline" size="sm" onClick={onExport} disabled={isExporting}>
              {isExporting ? EXPORTING_LABEL : EXPORT_MARKDOWN_LABEL}
            </Button>
          </div>
          <div className="text-center px-4 py-2 rounded-md bg-background border border-border">
            <div className="text-2xl font-bold font-mono text-primary">{project.l2Count}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {L2_NODES_LABEL}
            </div>
          </div>
          <div className="text-center px-4 py-2 rounded-md bg-background border border-border">
            <div className="text-2xl font-bold font-mono text-primary">{project.l3Count}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {L3_NODES_LABEL}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
