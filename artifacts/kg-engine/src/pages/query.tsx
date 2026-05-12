import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, BrainCircuit, Network, Tag, GitMerge, Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";

interface SearchResultItem {
  nodeLayer: "l1" | "l2" | "l3";
  id: number;
  title: string;
  content: string | null;
  projectId: number | null;
  projectName: string | null;
  score: number;
  createdAt: string;
}

interface SearchResponse {
  results: SearchResultItem[];
  total: number;
}

const layerColors: Record<string, string> = {
  l1: "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400",
  l2: "bg-primary/10 border-primary/20 text-primary",
  l3: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
};

const nodeTypeIcon = (layer: string) => {
  if (layer === "l1") return <Tag className="h-3 w-3 mr-1" />;
  if (layer === "l2") return <GitMerge className="h-3 w-3 mr-1" />;
  return <Network className="h-3 w-3 mr-1" />;
};

export default function Query() {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const { data: projects } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          projectId: projectFilter !== "all" ? Number(projectFilter) : undefined,
          limit: 20,
        }),
      });
      if (!res.ok) throw new Error("Search failed");
      const data: SearchResponse = await res.json();
      setResults(data.results);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8 text-center space-y-3 pt-8">
        <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-full mb-2">
          <BrainCircuit className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Semantic Knowledge Query</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto text-sm">
          Search across all L1 tags, L2 modules, and L3 decision records. Results traverse the full
          knowledge hierarchy.
        </p>
      </div>

      <form onSubmit={handleSearch} className="max-w-3xl mx-auto w-full mb-4">
        <div className="flex gap-2 mb-2">
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-48 h-11 text-sm">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects?.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/40 to-primary/20 rounded-xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
            <div className="relative flex items-center bg-card border border-border/80 rounded-xl overflow-hidden shadow-sm">
              <Search className="h-4 w-4 ml-3.5 text-muted-foreground shrink-0" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g., "How does the authentication module work?"'
                className="flex-1 border-0 bg-transparent h-11 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 px-3"
              />
              <Button
                type="submit"
                size="sm"
                className="h-full rounded-none px-6 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={!query.trim() || isSearching}
              >
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </Button>
            </div>
          </div>
        </div>
      </form>

      {error && (
        <div className="max-w-3xl mx-auto w-full mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {results !== null && (
        <div className="flex-1 space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center justify-between border-b border-border pb-2 max-w-3xl mx-auto w-full">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" />
              Results
            </h2>
            <div className="text-xs text-muted-foreground font-mono">
              {results.length} of {total} matches
            </div>
          </div>

          {results.length === 0 ? (
            <div className="max-w-3xl mx-auto w-full text-center py-12 text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>
                No results found for "<span className="font-medium">{query}</span>"
              </p>
              <p className="text-xs mt-1">
                Try a different search term or run the AI pipeline to generate more knowledge nodes.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full space-y-3 pb-8">
              {results.map((item, i) => (
                <Card
                  key={i}
                  className="border-border/60 bg-card/50 hover:border-primary/40 transition-colors"
                >
                  <CardHeader className="py-3 px-4 border-b border-border/40 bg-muted/20 flex flex-row items-center justify-between space-y-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-mono uppercase px-1.5 py-0 h-5 ${layerColors[item.nodeLayer]}`}
                      >
                        {nodeTypeIcon(item.nodeLayer)}
                        {item.nodeLayer.toUpperCase()}
                      </Badge>
                      {item.projectName && (
                        <span className="text-xs text-muted-foreground font-mono">
                          {item.projectName}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      score: {item.score.toFixed(2)}
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <h4 className="text-sm font-semibold mb-1">{item.title}</h4>
                    {item.content && (
                      <p className="text-xs text-muted-foreground font-mono bg-muted/40 p-2.5 rounded border border-border/40 line-clamp-3">
                        {item.content}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {results === null && !isSearching && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground space-y-2">
            <div className="text-xs font-mono bg-muted/40 border border-border rounded-md px-4 py-2 space-y-1">
              <div>search_knowledge(query, project?)</div>
              <div>get_dependencies(module)</div>
              <div>impact_analysis(module)</div>
              <div>get_decision_record(commit_hash)</div>
            </div>
            <p className="text-xs">
              MCP tool endpoints available at{" "}
              <code className="bg-muted px-1 rounded">/api/mcp/*</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
