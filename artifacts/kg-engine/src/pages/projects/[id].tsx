import { useParams } from "wouter";
import {
  useGetProject,
  getGetProjectQueryKey,
  useGetProjectGraph,
  getGetProjectGraphQueryKey,
  useListCommits,
  getListCommitsQueryKey,
  useListProjectL2Nodes,
  getListProjectL2NodesQueryKey,
  useListL3Nodes,
  getListL3NodesQueryKey,
  useExportProjectMarkdown,
  getExportProjectMarkdownQueryKey,
} from "@workspace/api-client-react";
import { IngestStatusCard } from "@/components/IngestStatusCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  GitCommit,
  GitMerge,
  Network,
  GitBranch,
  Terminal,
  ChevronDown,
  ChevronRight,
  FileCode,
  BookOpen,
  Lightbulb,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { L2Node, L3Node } from "@workspace/api-client-react";
import { L2BootstrapReview } from "@/components/L2BootstrapReview";
import { ProjectTopologyGraph } from "@/components/graph/ProjectTopologyGraph";
import { ArchitectureFlowchart } from "@/components/graph/ArchitectureFlowchart";

const L3_TYPE_ICON: Record<string, React.ReactNode> = {
  change: <GitCommit className="h-3 w-3" />,
  rule: <FileCode className="h-3 w-3" />,
  decision: <Lightbulb className="h-3 w-3" />,
  context: <BookOpen className="h-3 w-3" />,
};

const L3_TYPE_COLOR: Record<string, string> = {
  change: "border-blue-500/30 text-blue-400",
  rule: "border-orange-500/30 text-orange-400",
  decision: "border-purple-500/30 text-purple-400",
  context: "border-green-500/30 text-green-400",
};

function L3NodeRow({ node }: { node: L3Node }) {
  return (
    <div className="pl-4 pr-3 py-2 border-l-2 border-border/50 ml-3 hover:bg-accent/30 transition-colors rounded-r-md">
      <div className="flex items-start gap-2">
        <Badge
          variant="outline"
          className={`text-[9px] uppercase shrink-0 mt-0.5 gap-1 ${L3_TYPE_COLOR[node.nodeType] ?? ""}`}
        >
          {L3_TYPE_ICON[node.nodeType]}
          {node.nodeType}
        </Badge>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-snug">{node.title}</p>
          {node.content && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{node.content}</p>
          )}
          <div className="flex items-center gap-3 mt-1">
            {node.confidence != null && (
              <span className="text-[10px] text-muted-foreground">
                Confidence:{" "}
                <span
                  className={
                    node.confidence >= 0.8
                      ? "text-green-400"
                      : node.confidence >= 0.5
                        ? "text-yellow-400"
                        : "text-red-400"
                  }
                >
                  {Math.round(node.confidence * 100)}%
                </span>
              </span>
            )}
            {node.commitHash && (
              <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {node.commitHash.slice(0, 7)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function L2NodeCard({ node, projectId }: { node: L2Node; projectId: number }) {
  const [expanded, setExpanded] = useState(false);

  const { data: l3Nodes, isLoading: loadingL3 } = useListL3Nodes(node.id, {
    query: {
      enabled: expanded,
      queryKey: getListL3NodesQueryKey(node.id),
    },
  });

  const typeColor: Record<string, string> = {
    module: "border-primary/40 text-primary",
    package: "border-cyan-500/40 text-cyan-400",
    pcd: "border-amber-500/40 text-amber-400",
  };

  return (
    <div className="border border-border rounded-md bg-background overflow-hidden">
      <button
        className="w-full text-left p-3 flex items-start gap-3 hover:bg-accent/40 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="mt-0.5 shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium text-primary">{node.name}</span>
            <Badge
              variant="outline"
              className={`text-[9px] uppercase ${typeColor[node.type] ?? ""}`}
            >
              {node.type}
            </Badge>
            {node.needsReview && (
              <Badge
                variant="outline"
                className="text-[9px] uppercase border-yellow-500/40 text-yellow-400 gap-1"
              >
                <AlertCircle className="h-2.5 w-2.5" />
                Review
              </Badge>
            )}
            {node.aiGenerated && (
              <Badge variant="secondary" className="text-[9px] uppercase">
                AI
              </Badge>
            )}
          </div>
          {node.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{node.description}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <span className="text-xs text-muted-foreground font-mono">{node.l3Count} L3</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 bg-muted/20 px-3 py-2 space-y-1">
          {loadingL3 ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : l3Nodes && l3Nodes.length > 0 ? (
            l3Nodes.map((n) => <L3NodeRow key={n.id} node={n} />)
          ) : (
            <p className="text-xs text-muted-foreground py-2 text-center">No L3 nodes yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

function L2Directory({ projectId }: { projectId: number }) {
  const { data: l2Nodes, isLoading } = useListProjectL2Nodes(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectL2NodesQueryKey(projectId) },
  });

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filtered = (l2Nodes ?? []).filter((n) => {
    const matchesSearch =
      search === "" ||
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      (n.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || n.type === typeFilter;
    return matchesSearch && matchesType;
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!l2Nodes || l2Nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-16">
        <GitMerge className="h-12 w-12 opacity-20" />
        <p className="text-sm">
          No L2 nodes found. Run the AI generation pipeline to extract components.
        </p>
      </div>
    );
  }

  const counts = { all: l2Nodes.length, module: 0, package: 0, pcd: 0 };
  for (const n of l2Nodes) {
    if (n.type in counts) counts[n.type as keyof typeof counts]++;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search components..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-40 text-sm bg-background border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
        />
        <div className="flex gap-1">
          {(["all", "module", "package", "pcd"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                typeFilter === t
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
              }`}
            >
              {t === "all" ? `All (${counts.all})` : `${t} (${counts[t]})`}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No results match your filter.
            </p>
          ) : (
            filtered.map((node) => <L2NodeCard key={node.id} node={node} projectId={projectId} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function ProjectDetail() {
  const params = useParams();
  const id = params.id ? parseInt(params.id, 10) : 0;

  const { data: project, isLoading: isLoadingProject } = useGetProject(id, {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) },
  });

  const { data: graph, isLoading: isLoadingGraph } = useGetProjectGraph(id, {
    query: { enabled: !!id, queryKey: getGetProjectGraphQueryKey(id) },
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
      link.setAttribute("download", `${project?.name || "project"}_export.md`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    }
  };

  const { data: commits, isLoading: isLoadingCommits } = useListCommits(id, {
    query: { enabled: !!id, queryKey: getListCommitsQueryKey(id) },
  });

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
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (!project)
    return (
      <div className="p-6 flex items-center justify-center h-full text-muted-foreground">
        Project not found
      </div>
    );

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex-none p-6 border-b border-border bg-card/30">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
              <Badge
                variant={project.status === "active" ? "default" : "secondary"}
                className="font-mono uppercase text-[10px]"
              >
                {project.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Terminal className="h-3 w-3" /> {project.repoUrl}
              </span>
              <span>Created {format(new Date(project.createdAt), "MMM d, yyyy")}</span>
            </div>
            {project.description && <p className="mt-4 text-sm max-w-3xl">{project.description}</p>}
            <div className="mt-4 max-w-xl">
              <IngestStatusCard projectId={id} repoUrl={project.repoUrl} />
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
                {isExporting ? "Exporting..." : "Export Markdown"}
              </Button>
            </div>
            <div className="text-center px-4 py-2 rounded-md bg-background border border-border">
              <div className="text-2xl font-bold font-mono text-primary">{project.l2Count}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                L2 Nodes
              </div>
            </div>
            <div className="text-center px-4 py-2 rounded-md bg-background border border-border">
              <div className="text-2xl font-bold font-mono text-primary">{project.l3Count}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                L3 Nodes
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 min-h-0 overflow-hidden">
        <Tabs defaultValue="architecture" className="h-full flex flex-col">
          <TabsList className="bg-background border border-border">
            <TabsTrigger
              value="architecture"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <Network className="h-4 w-4 mr-2" /> Architecture Flow
            </TabsTrigger>
            <TabsTrigger
              value="graph"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <Network className="h-4 w-4 mr-2" /> Topology Map
            </TabsTrigger>
            <TabsTrigger
              value="commits"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <GitCommit className="h-4 w-4 mr-2" /> Commits
            </TabsTrigger>
            <TabsTrigger
              value="l2"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              <GitMerge className="h-4 w-4 mr-2" /> L2 Directory
            </TabsTrigger>
            {unconfirmedCount > 0 && (
              <TabsTrigger
                value="bootstrap"
                className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-600 relative"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Bootstrap Review
                <Badge className="ml-2 bg-orange-500 hover:bg-orange-600 text-[10px] h-4 min-w-4 p-0 px-1 flex items-center justify-center">
                  {unconfirmedCount}
                </Badge>
              </TabsTrigger>
            )}
          </TabsList>

          <div className="flex-1 mt-4 overflow-hidden">
            <TabsContent value="architecture" className="h-full m-0 p-0">
              <ArchitectureFlowchart projectId={id} />
            </TabsContent>

            <TabsContent value="graph" className="h-full m-0 p-0">
              <Card className="h-full flex flex-col border-border bg-card/50">
                <CardHeader className="flex-none border-b border-border py-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Network className="h-4 w-4 text-primary" />
                    Interactive Topology Map
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden relative">
                  <ProjectTopologyGraph projectId={id} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="commits" className="h-full m-0 p-0">
              <Card className="h-full flex flex-col border-border bg-card/50">
                <CardContent className="flex-1 p-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    {isLoadingCommits ? (
                      <div className="p-6 space-y-4">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : commits && commits.length > 0 ? (
                      <div className="divide-y divide-border">
                        {commits.map((commit) => (
                          <div key={commit.id} className="p-4 hover:bg-accent/50 transition-colors">
                            <div className="flex items-start gap-4">
                              <div className="mt-1 bg-muted p-2 rounded-md shrink-0">
                                <GitBranch className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-4">
                                  <p className="text-sm font-medium text-foreground truncate">
                                    {commit.message}
                                  </p>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <Badge
                                      variant={commit.valid ? "outline" : "destructive"}
                                      className={
                                        commit.valid ? "border-primary/50 text-primary" : ""
                                      }
                                    >
                                      {commit.valid ? "VALID" : "INVALID"}
                                    </Badge>
                                    <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                      {commit.hash.substring(0, 7)}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                  <span className="font-medium text-primary/80">
                                    {commit.author}
                                  </span>
                                  <span>
                                    {format(new Date(commit.createdAt), "MMM d, yyyy HH:mm")}
                                  </span>
                                  {commit.l2NodeId && (
                                    <span className="flex items-center gap-1 text-primary">
                                      <Network className="h-3 w-3" /> Linked to L2
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                        <GitCommit className="h-12 w-12 mb-4 opacity-20" />
                        <p>No commits found for this project.</p>
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="l2" className="h-full m-0 p-0">
              <Card className="h-full flex flex-col border-border bg-card/50 overflow-hidden">
                <CardHeader className="flex-none border-b border-border py-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <GitMerge className="h-4 w-4 text-primary" />
                    L2 Component Directory
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden">
                  <L2Directory projectId={id} />
                </CardContent>
              </Card>
            </TabsContent>
            {unconfirmedCount > 0 && (
              <TabsContent value="bootstrap" className="h-full m-0 p-0">
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
