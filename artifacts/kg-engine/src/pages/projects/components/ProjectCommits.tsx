import { format } from "date-fns";
import { GitBranch, GitCommit, Network } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { useListCommits, getListCommitsQueryKey } from "@workspace/api-client-react";

interface ProjectCommitsProps {
  projectId: number;
}

export function ProjectCommits({ projectId }: ProjectCommitsProps) {
  const { data: commits, isLoading: isLoadingCommits } = useListCommits(projectId, {
    query: { enabled: !!projectId, queryKey: getListCommitsQueryKey(projectId) },
  });

  return (
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
                    <p className="text-sm font-medium text-foreground truncate">{commit.message}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={commit.valid ? "outline" : "destructive"}
                        className={commit.valid ? "border-primary/50 text-primary" : ""}
                      >
                        {commit.valid ? "VALID" : "INVALID"}
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
  );
}
