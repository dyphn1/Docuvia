import { useParams } from "wouter";
import { 
  useGetProject, 
  getGetProjectQueryKey,
  useGetProjectGraph,
  getGetProjectGraphQueryKey,
  useListCommits,
  getListCommitsQueryKey
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitCommit, GitMerge, Network, GitBranch, Terminal } from "lucide-react";
import { format } from "date-fns";

export default function ProjectDetail() {
  const params = useParams();
  const id = params.id ? parseInt(params.id, 10) : 0;
  
  const { data: project, isLoading: isLoadingProject } = useGetProject(id, {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) }
  });

  const { data: graph, isLoading: isLoadingGraph } = useGetProjectGraph(id, {
    query: { enabled: !!id, queryKey: getGetProjectGraphQueryKey(id) }
  });

  const { data: commits, isLoading: isLoadingCommits } = useListCommits(id, {
    query: { enabled: !!id, queryKey: getListCommitsQueryKey(id) }
  });

  if (isLoadingProject) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  if (!project) return <div className="p-6 flex items-center justify-center h-full text-muted-foreground">Project not found</div>;

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex-none p-6 border-b border-border bg-card/30">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
              <Badge variant={project.status === 'active' ? 'default' : 'secondary'} className="font-mono uppercase text-[10px]">
                {project.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Terminal className="h-3 w-3" /> {project.repoUrl}</span>
              <span>Created {format(new Date(project.createdAt), "MMM d, yyyy")}</span>
            </div>
            {project.description && (
              <p className="mt-4 text-sm max-w-3xl">{project.description}</p>
            )}
          </div>
          
          <div className="flex gap-4">
            <div className="text-center px-4 py-2 rounded-md bg-background border border-border">
              <div className="text-2xl font-bold font-mono text-primary">{project.l2Count}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">L2 Nodes</div>
            </div>
            <div className="text-center px-4 py-2 rounded-md bg-background border border-border">
              <div className="text-2xl font-bold font-mono text-primary">{project.l3Count}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">L3 Nodes</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 min-h-0 overflow-hidden">
        <Tabs defaultValue="graph" className="h-full flex flex-col">
          <TabsList className="bg-background border border-border">
            <TabsTrigger value="graph" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <Network className="h-4 w-4 mr-2" /> Graph View
            </TabsTrigger>
            <TabsTrigger value="commits" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <GitCommit className="h-4 w-4 mr-2" /> Commits
            </TabsTrigger>
            <TabsTrigger value="l2" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <GitMerge className="h-4 w-4 mr-2" /> L2 Directory
            </TabsTrigger>
          </TabsList>
          
          <div className="flex-1 mt-4 overflow-hidden">
            <TabsContent value="graph" className="h-full m-0 p-0">
              <Card className="h-full flex flex-col border-border bg-card/50">
                <CardHeader className="flex-none border-b border-border py-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Network className="h-4 w-4 text-primary" />
                    Knowledge Graph Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden relative">
                  {isLoadingGraph ? (
                    <div className="p-6 flex justify-center"><Skeleton className="h-64 w-full" /></div>
                  ) : graph ? (
                    <div className="absolute inset-0 p-6 overflow-auto">
                      <div className="space-y-8">
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">L1 Tags ({graph.l1Tags.length})</h3>
                          <div className="flex flex-wrap gap-2">
                            {graph.l1Tags.map(tag => (
                              <Badge key={tag.id} variant="outline" className="bg-primary/10 border-primary/20 text-primary">
                                {tag.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">L2 Components ({graph.l2Nodes.length})</h3>
                            <div className="space-y-2">
                              {graph.l2Nodes.slice(0, 10).map(node => (
                                <div key={node.id} className="p-3 rounded-md border border-border bg-background text-sm flex justify-between items-center">
                                  <span className="font-mono text-primary">{node.name}</span>
                                  <Badge variant="secondary" className="text-[10px] uppercase">{node.type}</Badge>
                                </div>
                              ))}
                              {graph.l2Nodes.length > 10 && (
                                <div className="text-xs text-muted-foreground text-center py-2">+ {graph.l2Nodes.length - 10} more</div>
                              )}
                            </div>
                          </div>
                          
                          <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">L3 Entities ({graph.l3Nodes.length})</h3>
                            <div className="space-y-2">
                              {graph.l3Nodes.slice(0, 10).map(node => (
                                <div key={node.id} className="p-3 rounded-md border border-border bg-background text-sm">
                                  <div className="flex justify-between items-start mb-1">
                                    <span className="font-medium truncate pr-2">{node.title}</span>
                                    <Badge variant="outline" className="text-[10px] uppercase shrink-0 border-primary/30 text-primary/80">{node.nodeType}</Badge>
                                  </div>
                                </div>
                              ))}
                              {graph.l3Nodes.length > 10 && (
                                <div className="text-xs text-muted-foreground text-center py-2">+ {graph.l3Nodes.length - 10} more</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 text-muted-foreground">No graph data available.</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="commits" className="h-full m-0 p-0">
              <Card className="h-full flex flex-col border-border bg-card/50">
                <CardContent className="flex-1 p-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    {isLoadingCommits ? (
                      <div className="p-6 space-y-4">
                        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                      </div>
                    ) : commits && commits.length > 0 ? (
                      <div className="divide-y divide-border">
                        {commits.map(commit => (
                          <div key={commit.id} className="p-4 hover:bg-accent/50 transition-colors">
                            <div className="flex items-start gap-4">
                              <div className="mt-1 bg-muted p-2 rounded-md shrink-0">
                                <GitBranch className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-4">
                                  <p className="text-sm font-medium text-foreground truncate">{commit.message}</p>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <Badge variant={commit.valid ? "outline" : "destructive"} className={commit.valid ? "border-primary/50 text-primary" : ""}>
                                      {commit.valid ? 'VALID' : 'INVALID'}
                                    </Badge>
                                    <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                      {commit.hash.substring(0, 7)}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                  <span className="font-medium text-primary/80">{commit.author}</span>
                                  <span>{format(new Date(commit.createdAt), "MMM d, yyyy HH:mm")}</span>
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
              <Card className="h-full border-border bg-card/50">
                <CardContent className="h-full p-0 flex items-center justify-center text-muted-foreground">
                  Select L2 Nodes from Graph View. Directory view under construction.
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}