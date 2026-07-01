import {
  useGetPullRequestDetail,
  getGetPullRequestDetailQueryKey,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface PullRequestDetailProps {
  projectId: number;
  prNumber: number;
  open: boolean;
  onClose: () => void;
}

export function PullRequestDetail({ projectId, prNumber, open, onClose }: PullRequestDetailProps) {
  const { data, isLoading } = useGetPullRequestDetail(projectId, prNumber, {
    query: {
      queryKey: getGetPullRequestDetailQueryKey(projectId, prNumber),
      enabled: open,
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>PR #{prNumber} — Knowledge Impact</SheetTitle>
          <SheetDescription>
            L2 modules and L3 decisions affected by this pull request.
          </SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        {data && (
          <div className="mt-6 space-y-6">
            <div className="flex gap-3 text-sm text-muted-foreground">
              <span>
                <strong>{data.commitsCount}</strong> commits
              </span>
              <span>•</span>
              <span>
                <strong>{data.l2Nodes.length}</strong> modules
              </span>
              <span>•</span>
              <span>
                <strong>{data.l3Nodes.length}</strong> decisions
              </span>
            </div>

            {data.aiSummary && (
              <div>
                <h3 className="font-semibold text-sm mb-2">AI Impact Summary</h3>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted rounded-md p-3 leading-relaxed">
                  {data.aiSummary}
                </div>
              </div>
            )}

            {data.l2Nodes.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-2">Modules Affected</h3>
                <div className="space-y-2">
                  {data.l2Nodes.map((node) => (
                    <div key={node.id} className="flex items-start gap-2 text-sm">
                      <Badge variant="outline" className="text-xs shrink-0">
                        {node.type}
                      </Badge>
                      <div>
                        <div className="font-medium">{node.name}</div>
                        {node.description && (
                          <div className="text-muted-foreground text-xs">{node.description}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.l3Nodes.length > 0 && (
              <div>
                <Separator />
                <h3 className="font-semibold text-sm mt-4 mb-2">Decisions & Changes</h3>
                <div className="space-y-2">
                  {data.l3Nodes.map((node) => (
                    <div key={node.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {node.nodeType}
                        </Badge>
                        <span className="font-medium">{node.title}</span>
                      </div>
                      {node.content && (
                        <p className="text-muted-foreground text-xs mt-1 ml-1 line-clamp-3">
                          {node.content}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!data.aiSummary && data.l2Nodes.length === 0 && data.l3Nodes.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No knowledge graph changes detected yet. Try running "Analyze Now".
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
