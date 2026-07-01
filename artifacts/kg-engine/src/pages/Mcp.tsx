import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Cpu, Play, Copy, CheckCircle2, ExternalLink } from "lucide-react";
import {
  useMcpListProjects,
  useMcpSearchKnowledge,
  useMcpGetDependencies,
  useMcpImpactAnalysis,
  useMcpGetDecisionRecord,
  getMcpListProjectsQueryKey,
  getMcpSearchKnowledgeQueryKey,
  getMcpGetDependenciesQueryKey,
  getMcpImpactAnalysisQueryKey,
  getMcpGetDecisionRecordQueryKey,
} from "@workspace/api-client-react";

interface Endpoint {
  name: string;
  method: "GET" | "POST";
  path: string;
  description: string;
  params: Array<{ name: string; placeholder: string; required: boolean }>;
}

const endpoints: Endpoint[] = [
  {
    name: "list_projects",
    method: "GET",
    path: "/api/mcp/list_projects",
    description: "List all projects with their L2/L3 node counts",
    params: [],
  },
  {
    name: "search_knowledge",
    method: "GET",
    path: "/api/mcp/search_knowledge",
    description: "Semantic search across the knowledge graph",
    params: [
      { name: "query", placeholder: "e.g. authentication module", required: true },
      { name: "project_id", placeholder: "optional project ID", required: false },
      { name: "limit", placeholder: "10", required: false },
    ],
  },
  {
    name: "get_dependencies",
    method: "GET",
    path: "/api/mcp/get_dependencies",
    description: "Get module dependency graph (what does this module depend on?)",
    params: [
      { name: "module", placeholder: "e.g. auth-service", required: true },
      { name: "project_id", placeholder: "optional project ID", required: false },
    ],
  },
  {
    name: "impact_analysis",
    method: "GET",
    path: "/api/mcp/impact_analysis",
    description: "Impact analysis (what breaks if this module changes?)",
    params: [
      { name: "module", placeholder: "e.g. database-layer", required: true },
      { name: "project_id", placeholder: "optional project ID", required: false },
    ],
  },
  {
    name: "get_decision_record",
    method: "GET",
    path: "/api/mcp/get_decision_record",
    description: "Fetch L3 decision records linked to a commit hash",
    params: [{ name: "commit_hash", placeholder: "e.g. a1b2c3d", required: true }],
  },
];

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const listProjects = useMcpListProjects({
    query: {
      enabled: false,
      queryKey: getMcpListProjectsQueryKey(),
    },
  });

  const searchKnowledgeParams = {
    query: params.query || "",
    project_id: params.project_id ? Number(params.project_id) : undefined,
    limit: params.limit ? Number(params.limit) : undefined,
  };
  const searchKnowledge = useMcpSearchKnowledge(searchKnowledgeParams, {
    query: {
      enabled: false,
      queryKey: getMcpSearchKnowledgeQueryKey(searchKnowledgeParams),
    },
  });

  const getDependenciesParams = {
    module: params.module || "",
    project_id: params.project_id ? Number(params.project_id) : undefined,
  };
  const getDependencies = useMcpGetDependencies(getDependenciesParams, {
    query: {
      enabled: false,
      queryKey: getMcpGetDependenciesQueryKey(getDependenciesParams),
    },
  });

  const impactAnalysisParams = {
    module: params.module || "",
    project_id: params.project_id ? Number(params.project_id) : undefined,
  };
  const impactAnalysis = useMcpImpactAnalysis(impactAnalysisParams, {
    query: {
      enabled: false,
      queryKey: getMcpImpactAnalysisQueryKey(impactAnalysisParams),
    },
  });

  const getDecisionRecordParams = { commit_hash: params.commit_hash || "" };
  const getDecisionRecord = useMcpGetDecisionRecord(getDecisionRecordParams, {
    query: {
      enabled: false,
      queryKey: getMcpGetDecisionRecordQueryKey(getDecisionRecordParams),
    },
  });

  const buildUrl = () => {
    const filled = Object.entries(params).filter(([, v]) => v.trim());
    if (!filled.length) return endpoint.path;
    const qs = new URLSearchParams(Object.fromEntries(filled)).toString();
    return `${endpoint.path}?${qs}`;
  };

  const handleRun = async () => {
    setLoading(true);
    setResult(null);
    try {
      let res;
      switch (endpoint.name) {
        case "list_projects":
          res = await listProjects.refetch();
          break;
        case "search_knowledge":
          res = await searchKnowledge.refetch();
          break;
        case "get_dependencies":
          res = await getDependencies.refetch();
          break;
        case "impact_analysis":
          res = await impactAnalysis.refetch();
          break;
        case "get_decision_record":
          res = await getDecisionRecord.refetch();
          break;
        default:
          throw new Error("Unknown endpoint");
      }
      if (res.error) throw res.error;
      setResult(res.data);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    const base = window.location.origin;
    navigator.clipboard.writeText(`${base}${buildUrl()}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="py-3 px-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-[10px] font-mono bg-primary/10 border-primary/20 text-primary"
            >
              {endpoint.method}
            </Badge>
            <code className="text-xs font-mono text-foreground">{endpoint.path}</code>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
            {copied ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
        <CardDescription className="text-xs mt-1">{endpoint.description}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {endpoint.params.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {endpoint.params.map((p) => (
              <div key={p.name} className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {p.name} {p.required && <span className="text-destructive">*</span>}
                </label>
                <Input
                  placeholder={p.placeholder}
                  value={params[p.name] ?? ""}
                  onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
                  className="h-7 text-xs font-mono"
                />
              </div>
            ))}
          </div>
        )}

        <Button size="sm" className="w-full" onClick={handleRun} disabled={loading}>
          {loading ? (
            "Calling..."
          ) : (
            <>
              <Play className="h-3 w-3 mr-2" />
              Run
            </>
          )}
        </Button>

        {result !== null && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground uppercase font-medium">
                Response
              </span>
            </div>
            <pre className="text-[10px] font-mono bg-muted/40 border border-border/50 rounded p-3 overflow-auto max-h-48 text-foreground whitespace-pre-wrap">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function McpPage() {
  return (
    <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCP Tool Endpoints</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Phase 5 — Agent-callable endpoints following the Model Context Protocol pattern
          </p>
        </div>
        <Badge variant="outline" className="flex items-center gap-1.5 text-xs">
          <Cpu className="h-3 w-3" />5 tools available
        </Badge>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3 text-sm">
            <ExternalLink className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <div className="font-medium text-sm">Using these endpoints in an AI agent</div>
              <p className="text-xs text-muted-foreground">
                These REST endpoints can be called by any LLM agent as tools. Base URL:{" "}
                <code className="bg-muted px-1 rounded font-mono text-foreground">/api/mcp/</code>
              </p>
              <p className="text-xs text-muted-foreground">
                All endpoints return JSON. Use{" "}
                <code className="bg-muted px-1 rounded font-mono text-foreground">GET</code> with
                query parameters. Integrate with Claude, GPT-4, or any agent framework by
                registering these as tool definitions.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {endpoints.map((ep) => (
          <EndpointCard key={ep.name} endpoint={ep} />
        ))}
      </div>
    </div>
  );
}
