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
} from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { Separator } from "@/components/ui/Separator";
import { Badge } from "@/components/ui/Badge";
import {
  PR_DETAIL_TITLE_PREFIX,
  PR_DETAIL_TITLE_SUFFIX,
  PR_DETAIL_DESCRIPTION,
  PR_DETAIL_COMMITS_LABEL,
  PR_DETAIL_MODULES_LABEL,
  PR_DETAIL_DECISIONS_LABEL,
  PR_DETAIL_AI_SUMMARY_HEADING,
  PR_DETAIL_MODULES_AFFECTED_HEADING,
  PR_DETAIL_DECISIONS_HEADING,
  PR_DETAIL_NO_CHANGES_MESSAGE,
} from "@/constants/pull-requests";

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
          <SheetTitle>
            {PR_DETAIL_TITLE_PREFIX}
            {prNumber}
            {PR_DETAIL_TITLE_SUFFIX}
          </SheetTitle>
          <SheetDescription>{PR_DETAIL_DESCRIPTION}</SheetDescription>
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
                <strong>{data.commitsCount}</strong> {PR_DETAIL_COMMITS_LABEL}
              </span>
              <span>•</span>
              <span>
                <strong>{data.l2Nodes.length}</strong> {PR_DETAIL_MODULES_LABEL}
              </span>
              <span>•</span>
              <span>
                <strong>{data.l3Nodes.length}</strong> {PR_DETAIL_DECISIONS_LABEL}
              </span>
            </div>

            {data.aiSummary && (
              <div>
                <h3 className="font-semibold text-sm mb-2">{PR_DETAIL_AI_SUMMARY_HEADING}</h3>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted rounded-md p-3 leading-relaxed">
                  {data.aiSummary}
                </div>
              </div>
            )}

            {data.l2Nodes.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-2">{PR_DETAIL_MODULES_AFFECTED_HEADING}</h3>
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
                <h3 className="font-semibold text-sm mt-4 mb-2">{PR_DETAIL_DECISIONS_HEADING}</h3>
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
              <p className="text-sm text-muted-foreground">{PR_DETAIL_NO_CHANGES_MESSAGE}</p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
