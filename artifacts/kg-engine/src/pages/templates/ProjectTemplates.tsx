import {
  useListProjectTemplates,
  getListProjectTemplatesQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { TemplateEditor } from "./TemplateEditor";
import { PROJECT_TEMPLATES_SKELETON_COUNT } from "@/constants/templates";

export function ProjectTemplates({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const { data: templates, isLoading } = useListProjectTemplates(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectTemplatesQueryKey(projectId) },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: PROJECT_TEMPLATES_SKELETON_COUNT }, (_, i) => (
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
