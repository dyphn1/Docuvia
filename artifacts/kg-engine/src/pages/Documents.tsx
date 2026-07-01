import {
  useListProjects,
  getListProjectsQueryKey,
  useListMiscDocuments,
  getListMiscDocumentsQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Inbox } from "lucide-react";
import { normalizeProjects } from "@/lib/projects";
import { UploadTab } from "./documents/components/UploadTab";
import { MiscPoolTab } from "./documents/components/MiscPoolTab";

export default function Documents() {
  const { data: projectsData } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = normalizeProjects(projectsData);

  const { data: miscDocs } = useListMiscDocuments({
    query: { queryKey: getListMiscDocumentsQueryKey() },
  });

  return (
    <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ingest documents for knowledge extraction, or affiliate unaffiliated documents from the
          Misc Pool
        </p>
      </div>

      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-3.5 w-3.5" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="misc" className="gap-2">
            <Inbox className="h-3.5 w-3.5" />
            Misc Pool
            {miscDocs && miscDocs.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {miscDocs.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-4">
          <UploadTab projects={projects} />
        </TabsContent>

        <TabsContent value="misc" className="mt-4">
          <MiscPoolTab projects={projects} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
