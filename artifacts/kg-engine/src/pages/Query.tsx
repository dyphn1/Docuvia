import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Search, BrainCircuit, Network, Tag, GitMerge, Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useListProjects, getListProjectsQueryKey, useMcpQuery } from "@workspace/api-client-react";
import { normalizeProjects } from "@/lib/projects";
import {
  SEARCH_RESULT_LIMIT,
  ALL_PROJECTS_FILTER,
  SEARCH_MODE_KEYWORD_GRAPH,
  QUERY_PAGE_TITLE,
  QUERY_PAGE_SUBTITLE,
  ALL_PROJECTS_LABEL,
  SEARCH_INPUT_PLACEHOLDER,
  SEARCH_BUTTON_TEXT,
  SEARCH_FAILED_MESSAGE,
  RESULTS_HEADING,
  RESULTS_MATCHES_SUFFIX,
  RESULTS_OF_TEXT,
  SEARCH_MODE_LABELS,
  KEYWORD_FALLBACK_NOTICE,
  NO_RESULTS_PREFIX,
  NO_RESULTS_SUFFIX,
  NO_RESULTS_HINT,
  MCP_EXAMPLE_COMMANDS,
  MCP_ENDPOINTS_AVAILABLE_TEXT,
  MCP_ENDPOINTS_PATH_LABEL,
  NODE_LAYER_COLORS,
} from "@/constants/query";

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

type SearchMode = "semantic_vector" | "keyword_graph";

interface SearchResponse {
  results: SearchResultItem[];
  total: number;
  routingStrategy?: string;
  metadata?: {
    searchMode?: SearchMode;
  };
}

const nodeTypeIcon = (layer: string) => {
  if (layer === "l1") return <Tag className="h-3 w-3 mr-1" />;
  if (layer === "l2") return <GitMerge className="h-3 w-3 mr-1" />;
  return <Network className="h-3 w-3 mr-1" />;
};

export default function Query() {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS_FILTER);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: projectsData } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = normalizeProjects(projectsData);

  const mcpQueryMutation = useMcpQuery({
    request: {
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_MCP_PAT}`,
      },
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    setResults(null);

    mcpQueryMutation.mutate(
      {
        data: {
          q: query.trim(),
          project_id: projectFilter !== ALL_PROJECTS_FILTER ? Number(projectFilter) : undefined,
          limit: SEARCH_RESULT_LIMIT,
        },
      },
      {
        onSuccess: (data) => {
          const resData = data as unknown as SearchResponse;
          setResults(resData.results);
          setTotal(resData.total ?? resData.results?.length ?? 0);
          setSearchMode(resData.metadata?.searchMode ?? null);
          setIsSearching(false);
        },
        onError: (e) => {
          setError(e.message || SEARCH_FAILED_MESSAGE);
          setIsSearching(false);
        },
      }
    );
  };

  return (
    <div className="p-6 h-full flex flex-col max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8 text-center space-y-3 pt-8">
        <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-full mb-2">
          <BrainCircuit className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{QUERY_PAGE_TITLE}</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto text-sm">{QUERY_PAGE_SUBTITLE}</p>
      </div>

      <form onSubmit={handleSearch} className="max-w-3xl mx-auto w-full mb-4">
        <div className="flex gap-2 mb-2">
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-48 h-11 text-sm">
              <SelectValue placeholder={ALL_PROJECTS_LABEL} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS_FILTER}>{ALL_PROJECTS_LABEL}</SelectItem>
              {projects.map((p) => (
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
                placeholder={SEARCH_INPUT_PLACEHOLDER}
                className="flex-1 border-0 bg-transparent h-11 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 px-3"
              />
              <Button
                type="submit"
                size="sm"
                className="h-full rounded-none px-6 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={!query.trim() || isSearching}
              >
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : SEARCH_BUTTON_TEXT}
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
              {RESULTS_HEADING}
              {searchMode && (
                <Badge
                  variant="outline"
                  className={`text-[10px] font-mono px-1.5 py-0 h-5 ${
                    searchMode === SEARCH_MODE_KEYWORD_GRAPH
                      ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                      : "bg-primary/10 border-primary/20 text-primary"
                  }`}
                >
                  {searchMode === SEARCH_MODE_KEYWORD_GRAPH ? (
                    <Network className="h-3 w-3 mr-1" />
                  ) : (
                    <BrainCircuit className="h-3 w-3 mr-1" />
                  )}
                  {searchMode === SEARCH_MODE_KEYWORD_GRAPH
                    ? SEARCH_MODE_LABELS.keywordGraph
                    : SEARCH_MODE_LABELS.semanticVector}
                </Badge>
              )}
            </h2>
            <div className="text-xs text-muted-foreground font-mono">
              {results.length} {RESULTS_OF_TEXT} {total} {RESULTS_MATCHES_SUFFIX}
            </div>
          </div>

          {searchMode === SEARCH_MODE_KEYWORD_GRAPH && (
            <div className="max-w-3xl mx-auto w-full text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              {KEYWORD_FALLBACK_NOTICE}
            </div>
          )}

          {results.length === 0 ? (
            <div className="max-w-3xl mx-auto w-full text-center py-12 text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>
                {NO_RESULTS_PREFIX}
                <span className="font-medium">{query}</span>
                {NO_RESULTS_SUFFIX}
              </p>
              <p className="text-xs mt-1">{NO_RESULTS_HINT}</p>
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
                        className={`text-[10px] font-mono uppercase px-1.5 py-0 h-5 ${NODE_LAYER_COLORS[item.nodeLayer]}`}
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
              {MCP_EXAMPLE_COMMANDS.map((command) => (
                <div key={command}>{command}</div>
              ))}
            </div>
            <p className="text-xs">
              {MCP_ENDPOINTS_AVAILABLE_TEXT}{" "}
              <code className="bg-muted px-1 rounded">{MCP_ENDPOINTS_PATH_LABEL}</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
