import { useParams } from "wouter";
import {
  useGetProject,
  getGetProjectQueryKey,
  useListProjectL2Nodes,
  getListProjectL2NodesQueryKey,
  useExportProjectMarkdown,
  getExportProjectMarkdownQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { GitCommit, GitMerge, Network, CheckCircle2 } from "lucide-react";
import { L2BootstrapReview } from "@/components/L2BootstrapReview";
import { ProjectTopologyGraph } from "@/components/graph/ProjectTopologyGraph";
import { ArchitectureFlowchart } from "@/components/graph/ArchitectureFlowchart";

import { L2Directory } from "./components/L2Directory";
import { ProjectHeader } from "./components/ProjectHeader";
import { ProjectCommits } from "./components/ProjectCommits";
import {
  PROJECT_DETAIL_SKELETON_GRID_COUNT,
  PROJECT_NOT_FOUND_MESSAGE,
  PROJECT_DETAIL_TABS,
  ARCHITECTURE_FLOW_TAB_LABEL,
  TOPOLOGY_MAP_TAB_LABEL,
  COMMITS_TAB_LABEL,
  L2_DIRECTORY_TAB_LABEL,
  BOOTSTRAP_REVIEW_TAB_LABEL,
  INTERACTIVE_TOPOLOGY_MAP_HEADING,
  L2_COMPONENT_DIRECTORY_HEADING,
  EXPORT_FILENAME_FALLBACK,
  EXPORT_FILENAME_SUFFIX,
} from "@/constants/projects";

export default function ProjectDetail() {
  const params = useParams();
  const id = params.id ? parseInt(params.id, 10) : 0;

  const { data: project, isLoading: isLoadingProject } = useGetProject(id, {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) },
  });

  const { refetch: exportMarkdown, isFetching: isExporting } = useExportProjectMarkdown(id, {
    query: { enabled: false, queryKey: getExportProjectMarkdownQueryKey(id) },
  });

  const handleExport = async () => {
    const { data } = await exportMarkdown();
    if (data) {
      const url = window.URL.createObjectURL(new Blob([data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `${project?.name || EXPORT_FILENAME_FALLBACK}${EXPORT_FILENAME_SUFFIX}`
      );
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    }
  };

  const { data: l2Nodes } = useListProjectL2Nodes(id, {
    query: { enabled: !!id, queryKey: getListProjectL2NodesQueryKey(id) },
  });
  const unconfirmedCount =
    l2Nodes?.filter((n) => n.aiGenerated && !n.isBootstrapConfirmed)?.length || 0;

  if (isLoadingProject) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: PROJECT_DETAIL_SKELETON_GRID_COUNT }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (!project)
    return (
      <div className="p-6 flex items-center justify-center h-full text-muted-foreground">
        {PROJECT_NOT_FOUND_MESSAGE}
      </div>
    );

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ProjectHeader
        project={project}
        projectId={id}
        isExporting={isExporting}
        onExport={handleExport}
      />

      <div className="flex-1 p-6 min-h-0 overflow-hidden">
        <Tabs defaultValue={PROJECT_DETAIL_TABS.ARCHITECTURE} className="h-full flex flex-col">
          <TabsList className="bg-background border border-border">
            <TabsTrigger
              value={PROJECT_DETAIL_TABS.ARCHITECTURE}
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <Network className="h-4 w-4 mr-2" /> {ARCHITECTURE_FLOW_TAB_LABEL}
            </TabsTrigger>
            <TabsTrigger
              value={PROJECT_DETAIL_TABS.GRAPH}
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <Network className="h-4 w-4 mr-2" /> {TOPOLOGY_MAP_TAB_LABEL}
            </TabsTrigger>
            <TabsTrigger
              value={PROJECT_DETAIL_TABS.COMMITS}
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <GitCommit className="h-4 w-4 mr-2" /> {COMMITS_TAB_LABEL}
            </TabsTrigger>
            <TabsTrigger
              value={PROJECT_DETAIL_TABS.L2}
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <GitMerge className="h-4 w-4 mr-2" /> {L2_DIRECTORY_TAB_LABEL}
            </TabsTrigger>
            {unconfirmedCount > 0 && (
              <TabsTrigger
                value={PROJECT_DETAIL_TABS.BOOTSTRAP}
                className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-600 relative"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {BOOTSTRAP_REVIEW_TAB_LABEL}
                <Badge className="ml-2 bg-orange-500 hover:bg-orange-600 text-[10px] h-4 min-w-4 p-0 px-1 flex items-center justify-center">
                  {unconfirmedCount}
                </Badge>
              </TabsTrigger>
            )}
          </TabsList>

          <div className="flex-1 mt-4 overflow-hidden">
            <TabsContent value={PROJECT_DETAIL_TABS.ARCHITECTURE} className="h-full m-0 p-0">
              <ArchitectureFlowchart projectId={id} />
            </TabsContent>

            <TabsContent value={PROJECT_DETAIL_TABS.GRAPH} className="h-full m-0 p-0">
              <Card className="h-full flex flex-col border-border bg-card/50">
                <CardHeader className="flex-none border-b border-border py-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Network className="h-4 w-4 text-primary" />
                    {INTERACTIVE_TOPOLOGY_MAP_HEADING}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden relative">
                  <ProjectTopologyGraph projectId={id} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value={PROJECT_DETAIL_TABS.COMMITS} className="h-full m-0 p-0">
              <Card className="h-full flex flex-col border-border bg-card/50">
                <CardContent className="flex-1 p-0 overflow-hidden">
                  <ProjectCommits projectId={id} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value={PROJECT_DETAIL_TABS.L2} className="h-full m-0 p-0">
              <Card className="h-full flex flex-col border-border bg-card/50 overflow-hidden">
                <CardHeader className="flex-none border-b border-border py-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <GitMerge className="h-4 w-4 text-primary" />
                    {L2_COMPONENT_DIRECTORY_HEADING}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden">
                  <L2Directory projectId={id} />
                </CardContent>
              </Card>
            </TabsContent>
            {unconfirmedCount > 0 && (
              <TabsContent value={PROJECT_DETAIL_TABS.BOOTSTRAP} className="h-full m-0 p-0">
                <div className="bg-card border border-border h-full flex flex-col rounded-lg">
                  <L2BootstrapReview projectId={id} />
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>
    </div>
  );
}
