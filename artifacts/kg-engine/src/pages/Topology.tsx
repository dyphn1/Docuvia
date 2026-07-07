import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Loader2, AlertCircle, Network, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import {
  useListProjects,
  useGetProjectTopology,
  getGetProjectTopologyQueryKey,
} from "@workspace/api-client-react";
import { normalizeProjects } from "@/lib/projects";
import {
  PALETTE,
  DECISION_COLOR,
  computeLayout,
  convexHull,
  nodeRadius,
  type SimNode,
} from "./TopologyGraphLogic";

export default function Topology() {
  const { data: projectsData, isLoading: projectsLoading } = useListProjects();
  const projects = normalizeProjects(projectsData);
  const [projectId, setProjectId] = useState<string>("");
  const effectiveProjectId = projectId || (projects[0] ? String(projects[0].id) : "");

  const {
    data: graph,
    isLoading,
    error,
  } = useGetProjectTopology(Number(effectiveProjectId), undefined, {
    query: {
      enabled: !!effectiveProjectId,
      queryKey: getGetProjectTopologyQueryKey(Number(effectiveProjectId)),
    },
  });

  const layout = useMemo(() => (graph ? computeLayout(graph.nodes, graph.links) : null), [graph]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blast, setBlast] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const [hiddenGroups, setHiddenGroups] = useState<Set<number>>(new Set());
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const nodeById = useMemo(() => new Map((layout?.nodes ?? []).map((n) => [n.id, n])), [layout]);
  const incoming = useMemo(() => {
    const map = new Map<string, Array<{ source: string; linkType: string }>>();
    (layout?.links ?? []).forEach((l) => {
      const list = map.get(l.target.id) ?? [];
      list.push({ source: l.source.id, linkType: l.linkType });
      map.set(l.target.id, list);
    });
    return map;
  }, [layout]);

  const computeBlast = (id: string): Set<string> => {
    const seen = new Set([id]);
    let frontier = [id];
    for (let depth = 0; depth < 3 && frontier.length; depth++) {
      const next: string[] = [];
      for (const nid of frontier) {
        for (const edge of incoming.get(nid) ?? []) {
          if (!seen.has(edge.source)) {
            seen.add(edge.source);
            next.push(edge.source);
          }
        }
      }
      frontier = next;
    }
    return seen;
  };

  const handleNodeClick = (n: SimNode) => {
    if (selectedId === n.id) {
      setBlast(blast ? null : computeBlast(n.id));
    } else {
      setSelectedId(n.id);
      setBlast(null);
    }
  };

  const selected = selectedId ? nodeById.get(selectedId) : null;
  const searchResults =
    search.trim() && layout
      ? layout.nodes
          .filter((n) => n.label.toLowerCase().includes(search.trim().toLowerCase()))
          .slice(0, 15)
      : [];

  const centerOn = (n: SimNode) => {
    const svg = svgRef.current;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    setView((v) => ({ k: v.k, x: width / 2 - (n.x ?? 0) * v.k, y: height / 2 - (n.y ?? 0) * v.k }));
    setSelectedId(n.id);
    setBlast(null);
  };

  return (
    <div className="flex h-full gap-4 p-4" data-testid="topology-page">
      <div className="flex w-96 flex-col gap-4 overflow-y-auto">
        <Card>
          <CardContent className="pt-4">
            <Input
              placeholder="Search nodes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="topology-search"
            />
            {searchResults.map((n) => (
              <div
                key={n.id}
                className="mt-1 cursor-pointer truncate rounded px-2 py-1 text-sm hover:bg-accent"
                onClick={() => centerOn(n)}
              >
                {n.label} <span className="text-muted-foreground">({n.kind})</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Node Info</CardTitle>
          </CardHeader>
          <CardContent className="text-sm" data-testid="topology-node-info">
            {!selected && (
              <p className="text-muted-foreground">
                Click a node to inspect it. Click it again to highlight its blast radius (upstream
                dependents).
              </p>
            )}
            {selected && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <b className="truncate">{selected.label}</b>
                  <Badge variant="secondary">{selected.kind}</Badge>
                </div>
                {selected.filePath && (
                  <div className="truncate text-muted-foreground">{selected.filePath}</div>
                )}
                <div>group: {graph?.groups.find((g) => g.id === selected.group)?.label}</div>
                <div>degree: {selected.degree}</div>
                {!!selected.tags?.length && <div>tags: {selected.tags.join(", ")}</div>}
                {blast && (
                  <div className="font-semibold text-destructive">
                    blast radius: {blast.size - 1} upstream nodes
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Groups</CardTitle>
          </CardHeader>
          <CardContent>
            {(graph?.groups ?? []).map((g) => (
              <div
                key={g.id}
                className={`flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent ${hiddenGroups.has(g.id) ? "opacity-30" : ""}`}
                onClick={() =>
                  setHiddenGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.id)) next.delete(g.id);
                    else next.add(g.id);
                    return next;
                  })
                }
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: PALETTE[g.id % PALETTE.length] }}
                />
                <span className="flex-1 truncate">{g.label}</span>
                <span className="text-muted-foreground">{g.count}</span>
              </div>
            ))}
            {graph && (
              <p className="mt-3 text-xs text-muted-foreground">
                {graph.stats.nodeCount} nodes · {graph.stats.linkCount} links ·{" "}
                {graph.stats.groupCount} groups
                {graph.collapsed ? " · collapsed to file level" : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 overflow-hidden relative">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" /> Topology
          </CardTitle>
          <div className="w-64">
            <Select value={effectiveProjectId} onValueChange={setProjectId}>
              <SelectTrigger data-testid="topology-project-select">
                <SelectValue
                  placeholder={projectsLoading ? "Loading projects…" : "Select project"}
                />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <div className="absolute right-4 top-16 z-10 flex flex-col gap-2">
          <Button
            variant="secondary"
            size="icon"
            onClick={() =>
              setView((v) => {
                const svg = svgRef.current;
                if (!svg) return v;
                const { width, height } = svg.getBoundingClientRect();
                const mx = width / 2;
                const my = height / 2;
                const k = Math.min(v.k * 1.5, 8);
                return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
              })
            }
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() =>
              setView((v) => {
                const svg = svgRef.current;
                if (!svg) return v;
                const { width, height } = svg.getBoundingClientRect();
                const mx = width / 2;
                const my = height / 2;
                const k = Math.max(v.k / 1.5, 0.05);
                return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
              })
            }
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => {
              if (!svgRef.current || !layout) return;
              const minX = Math.min(...layout.nodes.map((n) => n.x ?? 0));
              const maxX = Math.max(...layout.nodes.map((n) => n.x ?? 0));
              const minY = Math.min(...layout.nodes.map((n) => n.y ?? 0));
              const maxY = Math.max(...layout.nodes.map((n) => n.y ?? 0));
              const { width, height } = svgRef.current.getBoundingClientRect();
              const k = Math.min(width / (maxX - minX + 200), height / (maxY - minY + 200), 2);
              setView({
                k,
                x: width / 2 - (k * (minX + maxX)) / 2,
                y: height / 2 - (k * (minY + maxY)) / 2,
              });
            }}
          >
            <Maximize className="h-4 w-4" />
          </Button>
        </div>

        <CardContent className="h-[calc(100%-4rem)] p-0">
          {isLoading && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Building topology…
            </div>
          )}
          {!!error && (
            <div className="flex h-full items-center justify-center text-destructive">
              <AlertCircle className="mr-2 h-5 w-5" /> Failed to load topology.
            </div>
          )}
          {layout && !isLoading && (
            <svg
              ref={svgRef}
              className="h-full w-full cursor-grab active:cursor-grabbing"
              data-testid="topology-canvas"
              onPointerDown={(e) => {
                dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
                (e.target as Element).setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!dragRef.current) return;
                const dx = e.clientX - dragRef.current.x;
                const dy = e.clientY - dragRef.current.y;
                if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
                dragRef.current = { x: e.clientX, y: e.clientY, moved: dragRef.current.moved };
                setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
              }}
              onPointerUp={() => {
                if (dragRef.current && !dragRef.current.moved) {
                  setSelectedId(null);
                  setBlast(null);
                }
                dragRef.current = null;
              }}
              onWheel={(e) => {
                const svg = svgRef.current;
                if (!svg) return;
                const rect = svg.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                setView((v) => {
                  const k = Math.min(Math.max(v.k * Math.exp(-e.deltaY * 0.0012), 0.05), 8);
                  return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
                });
              }}
            >
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {(graph?.groups ?? []).map((g) => {
                  if (hiddenGroups.has(g.id)) return null;
                  const members = layout.nodes.filter((n) => n.group === g.id);
                  if (members.length < 2) return null;
                  const hull = convexHull(members.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 })));
                  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
                  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
                  const points = hull
                    .map((p) => `${cx + (p.x - cx) * 1.25},${cy + (p.y - cy) * 1.25}`)
                    .join(" ");
                  const color = PALETTE[g.id % PALETTE.length];
                  return (
                    <g key={g.id}>
                      <polygon
                        points={points}
                        fill={color}
                        fillOpacity={0.06}
                        stroke={color}
                        strokeOpacity={0.3}
                        strokeWidth={1.5 / view.k}
                      />
                      <text
                        x={cx}
                        y={cy}
                        fill={color}
                        opacity={0.75}
                        fontSize={13 / view.k}
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {g.label}
                      </text>
                    </g>
                  );
                })}
                {layout.links.map((l, i) => {
                  const a = l.source;
                  const b = l.target;
                  if (hiddenGroups.has(a.group) || hiddenGroups.has(b.group)) return null;
                  const inBlast = blast?.has(a.id) && blast?.has(b.id);
                  const opacity =
                    blast && !inBlast
                      ? 0.04
                      : l.linkType === "contains"
                        ? 0.1
                        : inBlast
                          ? 0.9
                          : 0.35;
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={
                        inBlast ? "#ff6b6b" : l.linkType === "decision" ? DECISION_COLOR : "#8b98b8"
                      }
                      strokeOpacity={opacity}
                      strokeWidth={(inBlast ? 2 : 1) / view.k}
                      strokeDasharray={
                        l.linkType === "decision" ? `${4 / view.k} ${3 / view.k}` : undefined
                      }
                    />
                  );
                })}
                {layout.nodes.map((n) => {
                  if (hiddenGroups.has(n.group)) return null;
                  const r = nodeRadius(n, layout.maxDegree);
                  const dimmed = blast && !blast.has(n.id);
                  const color =
                    n.kind === "decision" ? DECISION_COLOR : PALETTE[n.group % PALETTE.length];
                  const isSelected = selectedId === n.id;
                  return (
                    <g
                      key={n.id}
                      opacity={dimmed ? 0.12 : 1}
                      className="cursor-pointer"
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        if (!dragRef.current?.moved) handleNodeClick(n);
                        dragRef.current = null;
                      }}
                    >
                      {n.kind === "decision" ? (
                        <rect
                          x={(n.x ?? 0) - r}
                          y={(n.y ?? 0) - r}
                          width={r * 2}
                          height={r * 2}
                          fill={color}
                        />
                      ) : (
                        <circle
                          cx={n.x}
                          cy={n.y}
                          r={r}
                          fill={color}
                          stroke={n.kind === "file" ? "#f1f4fb" : "none"}
                          strokeWidth={1 / view.k}
                        />
                      )}
                      {isSelected && (
                        <circle
                          cx={n.x}
                          cy={n.y}
                          r={r + 3 / view.k}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth={2.5 / view.k}
                        />
                      )}
                      {(n.degree >= layout.maxDegree * 0.3 ||
                        isSelected ||
                        (blast?.has(n.id) && view.k > 0.7)) && (
                        <text
                          x={(n.x ?? 0) + r + 3 / view.k}
                          y={(n.y ?? 0) + 4 / view.k}
                          fontSize={11 / view.k}
                          fill="currentColor"
                          opacity={0.85}
                        >
                          {n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
