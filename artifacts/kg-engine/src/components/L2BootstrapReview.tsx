import { useState, useMemo } from "react";
import {
  useListProjectL2Nodes,
  useListL1Tags,
  useConfirmBootstrap,
  getListProjectL2NodesQueryKey,
  getListL1TagsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CheckCircle2, XCircle, FileCode, Check } from "lucide-react";

export function L2BootstrapReview({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  
  const { data: l2Nodes, isLoading: isL2Loading } = useListProjectL2Nodes(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectL2NodesQueryKey(projectId) },
  });

  const { data: l1Tags, isLoading: isL1Loading } = useListL1Tags({
    query: { enabled: true, queryKey: getListL1TagsQueryKey() },
  });

  const { mutate: confirmBootstrap, isPending } = useConfirmBootstrap({
    mutation: {
      onSuccess: () => {
        toast.success("Bootstrap confirmed successfully");
        queryClient.invalidateQueries({ queryKey: getListProjectL2NodesQueryKey(projectId) });
      },
      onError: (error) => {
        toast.error(`Failed to confirm: ${error.message}`);
      },
    },
  });

  const [decisions, setDecisions] = useState<Record<number, "approve" | "reject">>({});
  const [pathEdits, setPathEdits] = useState<Record<number, string>>({});

  const groupedNodes = useMemo(() => {
    if (!l2Nodes || !l1Tags) return {};
    
    const tagMap = new Map(l1Tags.map((t) => [t.id, t.name]));
    
    const grouped: Record<string, typeof l2Nodes> = {};
    for (const node of l2Nodes) {
      const tagId = node.l1TagIds?.[0]; // Assuming primarily single L1 tag for simplicity
      const tagName = tagId ? tagMap.get(tagId) ?? "Uncategorized" : "Uncategorized";
      
      if (!grouped[tagName]) {
        grouped[tagName] = [];
      }
      grouped[tagName].push(node);
    }
    return grouped;
  }, [l2Nodes, l1Tags]);

  if (isL2Loading || isL1Loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const unconfirmedNodes = l2Nodes?.filter((n) => n.aiGenerated && !n.isBootstrapConfirmed) || [];
  
  if (unconfirmedNodes.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <CheckCircle2 className="mx-auto h-12 w-12 text-primary mb-4 opacity-50" />
        <p>No new modules require confirmation.</p>
      </div>
    );
  }

  const handleApproveAll = () => {
    const newDecisions = { ...decisions };
    unconfirmedNodes.forEach((n) => {
      newDecisions[n.id] = "approve";
    });
    setDecisions(newDecisions);
  };

  const handleSubmit = () => {
    const approvedModules: { id: number; pathPatterns: string[] }[] = [];
    const rejectedModuleIds: number[] = [];

    for (const node of unconfirmedNodes) {
      const decision = decisions[node.id];
      if (decision === "approve") {
        const customPath = pathEdits[node.id];
        const patterns = customPath 
          ? customPath.split(",").map(s => s.trim()).filter(Boolean)
          : node.pathPatterns || [];
        approvedModules.push({ id: node.id, pathPatterns: patterns });
      } else if (decision === "reject") {
        rejectedModuleIds.push(node.id);
      }
    }

    if (approvedModules.length === 0 && rejectedModuleIds.length === 0) {
      toast.error("Please make a decision for at least one module");
      return;
    }

    confirmBootstrap({
      id: projectId,
      data: {
        approvedModules,
        rejectedModuleIds,
      },
    });
  };

  return (
    <div className="p-6 flex flex-col h-full overflow-hidden">
      <div className="flex justify-between items-center mb-6 shrink-0">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Review L2 Modules</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Approve or reject AI-generated modules to bootstrap this project.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleApproveAll}>
            Approve All
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : "Submit Decisions"}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 rounded-md border bg-muted/20">
        <div className="p-4 space-y-8">
          {Object.entries(groupedNodes).map(([tagName, nodes]) => {
            const hasUnconfirmed = nodes.some((n) => n.aiGenerated && !n.isBootstrapConfirmed);
            if (!hasUnconfirmed) return null;

            return (
              <div key={tagName} className="space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b">
                  <Badge variant="secondary">{tagName}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {nodes.length} module{nodes.length !== 1 ? 's' : ''}
                  </span>
                </div>
                
                <div className="grid gap-3">
                  {nodes.map((node) => {
                    const isNew = node.aiGenerated && !node.isBootstrapConfirmed;
                    if (!isNew) {
                      return (
                        <Card key={node.id} className="opacity-60 bg-muted">
                          <CardContent className="p-3 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <FileCode className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium text-sm">{node.name}</span>
                              <Badge variant="outline" className="text-[10px]">Existing</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground truncate max-w-sm">
                              {node.pathPatterns?.join(", ") || "No paths"}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    }

                    const decision = decisions[node.id];
                    const editedPath = pathEdits[node.id];
                    const displayPath = editedPath !== undefined ? editedPath : (node.pathPatterns?.join(", ") || "");

                    return (
                      <Card 
                        key={node.id} 
                        className={`transition-colors border-l-4 ${
                          decision === "approve" ? "border-l-green-500 bg-green-500/5" :
                          decision === "reject" ? "border-l-red-500 bg-red-500/5" :
                          "border-l-blue-500"
                        }`}
                      >
                        <CardContent className="p-4 flex flex-col gap-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold">{node.name}</span>
                                <Badge className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 text-[10px] border-blue-500/20">
                                  New
                                </Badge>
                                {decision === 'approve' && <Badge variant="outline" className="text-green-500 border-green-500/30 text-[10px]"><Check className="h-3 w-3 mr-1" /> Approved</Badge>}
                                {decision === 'reject' && <Badge variant="outline" className="text-red-500 border-red-500/30 text-[10px]"><XCircle className="h-3 w-3 mr-1" /> Rejected</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground">{node.description || "No description provided."}</p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button 
                                size="sm" 
                                variant={decision === "approve" ? "default" : "outline"}
                                className={decision === "approve" ? "bg-green-600 hover:bg-green-700" : "hover:text-green-600 hover:border-green-600"}
                                onClick={() => setDecisions(d => ({ ...d, [node.id]: "approve" }))}
                              >
                                Approve
                              </Button>
                              <Button 
                                size="sm" 
                                variant={decision === "reject" ? "destructive" : "outline"}
                                className={decision === "reject" ? "" : "hover:text-red-600 hover:border-red-600"}
                                onClick={() => setDecisions(d => ({ ...d, [node.id]: "reject" }))}
                              >
                                Reject
                              </Button>
                            </div>
                          </div>
                          
                          <div className="flex flex-col gap-1.5 mt-2">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Path Patterns (Glob)</span>
                            <Input 
                              value={displayPath}
                              onChange={(e) => setPathEdits(prev => ({ ...prev, [node.id]: e.target.value }))}
                              placeholder="e.g. src/components/**/*.tsx"
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
