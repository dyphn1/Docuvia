import {
  useListProjects,
  getListProjectsQueryKey,
  useListMiscDocuments,
  getListMiscDocumentsQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/Badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Upload, Inbox } from "lucide-react";
import { normalizeProjects } from "@/lib/projects";
import { UploadTab } from "./documents/components/UploadTab";
import { MiscPoolTab } from "./documents/components/MiscPoolTab";
import {
  DOCUMENTS_TAB_UPLOAD,
  DOCUMENTS_TAB_MISC_POOL,
  DOCUMENTS_PAGE_TITLE,
  DOCUMENTS_PAGE_DESCRIPTION,
  DOCUMENTS_TAB_UPLOAD_LABEL,
  DOCUMENTS_TAB_MISC_POOL_LABEL,
} from "@/constants/documents";

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
        <h1 className="text-2xl font-bold tracking-tight">{DOCUMENTS_PAGE_TITLE}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{DOCUMENTS_PAGE_DESCRIPTION}</p>
      </div>

      <Tabs defaultValue={DOCUMENTS_TAB_UPLOAD}>
        <TabsList>
          <TabsTrigger value={DOCUMENTS_TAB_UPLOAD} className="gap-2">
            <Upload className="h-3.5 w-3.5" />
            {DOCUMENTS_TAB_UPLOAD_LABEL}
          </TabsTrigger>
          <TabsTrigger value={DOCUMENTS_TAB_MISC_POOL} className="gap-2">
            <Inbox className="h-3.5 w-3.5" />
            {DOCUMENTS_TAB_MISC_POOL_LABEL}
            {miscDocs && miscDocs.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {miscDocs.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={DOCUMENTS_TAB_UPLOAD} className="mt-4">
          <UploadTab projects={projects} />
        </TabsContent>

        <TabsContent value={DOCUMENTS_TAB_MISC_POOL} className="mt-4">
          <MiscPoolTab projects={projects} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
