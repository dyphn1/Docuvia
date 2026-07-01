import { useState } from "react";
import {
  useListL3Nodes,
  getListL3NodesQueryKey,
  useListProjectL2Nodes,
  getListProjectL2NodesQueryKey,
  type L2Node,
  type L3Node,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  GitCommit,
  GitMerge,
  ChevronDown,
  ChevronRight,
  FileCode,
  BookOpen,
  Lightbulb,
  AlertCircle,
} from "lucide-react";

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

export function L2Directory({ projectId }: { projectId: number }) {
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
