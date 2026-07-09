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
import { computeLayout, convexHull, nodeRadius, type SimNode } from "./TopologyGraphLogic";
import {
  PALETTE,
  DECISION_COLOR,
  LINK_TYPE_CONTAINS,
  LINK_TYPE_DECISION,
  NODE_KIND_DECISION,
  NODE_KIND_FILE,
  BLAST_RADIUS_MAX_DEPTH,
  SEARCH_RESULTS_LIMIT,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP_FACTOR,
  WHEEL_ZOOM_SENSITIVITY,
  DRAG_MOVE_THRESHOLD_PX,
  FIT_VIEW_PADDING_PX,
  FIT_VIEW_MAX_ZOOM,
  HULL_EXPAND_FACTOR,
  NODE_LABEL_MAX_LENGTH,
  LABEL_VISIBILITY_DEGREE_RATIO,
  BLAST_HIGHLIGHT_COLOR,
  DEFAULT_LINK_COLOR,
  FILE_NODE_STROKE_COLOR,
  SELECTION_RING_COLOR,
  SEARCH_INPUT_PLACEHOLDER,
  PROJECT_SELECT_LOADING_PLACEHOLDER,
  PROJECT_SELECT_PLACEHOLDER,
  NODE_INFO_TITLE,
  NODE_INFO_EMPTY_HINT,
  GROUPS_TITLE,
  TOPOLOGY_TITLE,
  TOPOLOGY_LOADING_MESSAGE,
  TOPOLOGY_ERROR_MESSAGE,
  GROUP_LABEL_PREFIX,
  DEGREE_LABEL_PREFIX,
  TAGS_LABEL_PREFIX,
  BLAST_RADIUS_LABEL_PREFIX,
  BLAST_RADIUS_LABEL_SUFFIX,
  STATS_NODES_SUFFIX,
  STATS_LINKS_SUFFIX,
  STATS_GROUPS_SUFFIX,
  STATS_COLLAPSED_SUFFIX,
  TOPOLOGY_PAGE_TEST_ID,
  TOPOLOGY_SEARCH_TEST_ID,
  TOPOLOGY_NODE_INFO_TEST_ID,
  TOPOLOGY_PROJECT_SELECT_TEST_ID,
  TOPOLOGY_CANVAS_TEST_ID,
  HULL_FILL_OPACITY,
  HULL_STROKE_OPACITY,
  HULL_STROKE_WIDTH_BASE,
  HULL_LABEL_FONT_SIZE_BASE,
  HULL_LABEL_OPACITY,
  DECISION_LINK_DASH_ON_PX,
  DECISION_LINK_DASH_OFF_PX,
  LINK_OPACITY_DIMMED,
  LINK_OPACITY_CONTAINS,
  LINK_OPACITY_BLAST,
  LINK_OPACITY_DEFAULT,
  LINK_STROKE_WIDTH_BLAST,
  LINK_STROKE_WIDTH_DEFAULT,
  NODE_DIMMED_OPACITY,
  NODE_STROKE_WIDTH_BASE,
  SELECTION_RING_RADIUS_PADDING_PX,
  SELECTION_RING_STROKE_WIDTH,
  NODE_LABEL_OFFSET_X_PX,
  NODE_LABEL_OFFSET_Y_PX,
  NODE_LABEL_FONT_SIZE_BASE,
  NODE_LABEL_OPACITY,
  BLAST_LABEL_MIN_ZOOM,
  STROKE_NONE,
  CURRENT_COLOR,
} from "@/constants/topology";

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
    for (let depth = 0; depth < BLAST_RADIUS_MAX_DEPTH && frontier.length; depth++) {
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
          .slice(0, SEARCH_RESULTS_LIMIT)
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
    <div className="flex h-full gap-4 p-4" data-testid={TOPOLOGY_PAGE_TEST_ID}>
      <div className="flex w-96 flex-col gap-4 overflow-y-auto">
        <Card>
          <CardContent className="pt-4">
            <Input
              placeholder={SEARCH_INPUT_PLACEHOLDER}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid={TOPOLOGY_SEARCH_TEST_ID}
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
            <CardTitle className="text-sm">{NODE_INFO_TITLE}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm" data-testid={TOPOLOGY_NODE_INFO_TEST_ID}>
            {!selected && <p className="text-muted-foreground">{NODE_INFO_EMPTY_HINT}</p>}
            {selected && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <b className="truncate">{selected.label}</b>
                  <Badge variant="secondary">{selected.kind}</Badge>
                </div>
                {selected.filePath && (
                  <div className="truncate text-muted-foreground">{selected.filePath}</div>
                )}
                <div>
                  {GROUP_LABEL_PREFIX}
                  {graph?.groups.find((g) => g.id === selected.group)?.label}
                </div>
                <div>
                  {DEGREE_LABEL_PREFIX}
                  {selected.degree}
                </div>
                {!!selected.tags?.length && (
                  <div>
                    {TAGS_LABEL_PREFIX}
                    {selected.tags.join(", ")}
                  </div>
                )}
                {blast && (
                  <div className="font-semibold text-destructive">
                    {BLAST_RADIUS_LABEL_PREFIX}
                    {blast.size - 1}
                    {BLAST_RADIUS_LABEL_SUFFIX}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{GROUPS_TITLE}</CardTitle>
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
                {graph.stats.nodeCount}
                {STATS_NODES_SUFFIX}
                {graph.stats.linkCount}
                {STATS_LINKS_SUFFIX} {graph.stats.groupCount}
                {STATS_GROUPS_SUFFIX}
                {graph.collapsed ? STATS_COLLAPSED_SUFFIX : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 overflow-hidden relative">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" /> {TOPOLOGY_TITLE}
          </CardTitle>
          <div className="w-64">
            <Select value={effectiveProjectId} onValueChange={setProjectId}>
              <SelectTrigger data-testid={TOPOLOGY_PROJECT_SELECT_TEST_ID}>
                <SelectValue
                  placeholder={
                    projectsLoading
                      ? PROJECT_SELECT_LOADING_PLACEHOLDER
                      : PROJECT_SELECT_PLACEHOLDER
                  }
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
                const k = Math.min(v.k * ZOOM_STEP_FACTOR, MAX_ZOOM);
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
                const k = Math.max(v.k / ZOOM_STEP_FACTOR, MIN_ZOOM);
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
              const k = Math.min(
                width / (maxX - minX + FIT_VIEW_PADDING_PX),
                height / (maxY - minY + FIT_VIEW_PADDING_PX),
                FIT_VIEW_MAX_ZOOM
              );
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
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> {TOPOLOGY_LOADING_MESSAGE}
            </div>
          )}
          {!!error && (
            <div className="flex h-full items-center justify-center text-destructive">
              <AlertCircle className="mr-2 h-5 w-5" /> {TOPOLOGY_ERROR_MESSAGE}
            </div>
          )}
          {layout && !isLoading && (
            <svg
              ref={svgRef}
              className="h-full w-full cursor-grab active:cursor-grabbing"
              data-testid={TOPOLOGY_CANVAS_TEST_ID}
              onPointerDown={(e) => {
                dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
                (e.target as Element).setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!dragRef.current) return;
                const dx = e.clientX - dragRef.current.x;
                const dy = e.clientY - dragRef.current.y;
                if (Math.abs(dx) + Math.abs(dy) > DRAG_MOVE_THRESHOLD_PX)
                  dragRef.current.moved = true;
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
                  const k = Math.min(
                    Math.max(v.k * Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY), MIN_ZOOM),
                    MAX_ZOOM
                  );
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
                    .map(
                      (p) =>
                        `${cx + (p.x - cx) * HULL_EXPAND_FACTOR},${cy + (p.y - cy) * HULL_EXPAND_FACTOR}`
                    )
                    .join(" ");
                  const color = PALETTE[g.id % PALETTE.length];
                  return (
                    <g key={g.id}>
                      <polygon
                        points={points}
                        fill={color}
                        fillOpacity={HULL_FILL_OPACITY}
                        stroke={color}
                        strokeOpacity={HULL_STROKE_OPACITY}
                        strokeWidth={HULL_STROKE_WIDTH_BASE / view.k}
                      />
                      <text
                        x={cx}
                        y={cy}
                        fill={color}
                        opacity={HULL_LABEL_OPACITY}
                        fontSize={HULL_LABEL_FONT_SIZE_BASE / view.k}
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
                      ? LINK_OPACITY_DIMMED
                      : l.linkType === LINK_TYPE_CONTAINS
                        ? LINK_OPACITY_CONTAINS
                        : inBlast
                          ? LINK_OPACITY_BLAST
                          : LINK_OPACITY_DEFAULT;
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={
                        inBlast
                          ? BLAST_HIGHLIGHT_COLOR
                          : l.linkType === LINK_TYPE_DECISION
                            ? DECISION_COLOR
                            : DEFAULT_LINK_COLOR
                      }
                      strokeOpacity={opacity}
                      strokeWidth={
                        (inBlast ? LINK_STROKE_WIDTH_BLAST : LINK_STROKE_WIDTH_DEFAULT) / view.k
                      }
                      strokeDasharray={
                        l.linkType === LINK_TYPE_DECISION
                          ? `${DECISION_LINK_DASH_ON_PX / view.k} ${DECISION_LINK_DASH_OFF_PX / view.k}`
                          : undefined
                      }
                    />
                  );
                })}
                {layout.nodes.map((n) => {
                  if (hiddenGroups.has(n.group)) return null;
                  const r = nodeRadius(n, layout.maxDegree);
                  const dimmed = blast && !blast.has(n.id);
                  const color =
                    n.kind === NODE_KIND_DECISION
                      ? DECISION_COLOR
                      : PALETTE[n.group % PALETTE.length];
                  const isSelected = selectedId === n.id;
                  return (
                    <g
                      key={n.id}
                      opacity={dimmed ? NODE_DIMMED_OPACITY : 1}
                      className="cursor-pointer"
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        if (!dragRef.current?.moved) handleNodeClick(n);
                        dragRef.current = null;
                      }}
                    >
                      {n.kind === NODE_KIND_DECISION ? (
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
                          stroke={n.kind === NODE_KIND_FILE ? FILE_NODE_STROKE_COLOR : STROKE_NONE}
                          strokeWidth={NODE_STROKE_WIDTH_BASE / view.k}
                        />
                      )}
                      {isSelected && (
                        <circle
                          cx={n.x}
                          cy={n.y}
                          r={r + SELECTION_RING_RADIUS_PADDING_PX / view.k}
                          fill={STROKE_NONE}
                          stroke={SELECTION_RING_COLOR}
                          strokeWidth={SELECTION_RING_STROKE_WIDTH / view.k}
                        />
                      )}
                      {(n.degree >= layout.maxDegree * LABEL_VISIBILITY_DEGREE_RATIO ||
                        isSelected ||
                        (blast?.has(n.id) && view.k > BLAST_LABEL_MIN_ZOOM)) && (
                        <text
                          x={(n.x ?? 0) + r + NODE_LABEL_OFFSET_X_PX / view.k}
                          y={(n.y ?? 0) + NODE_LABEL_OFFSET_Y_PX / view.k}
                          fontSize={NODE_LABEL_FONT_SIZE_BASE / view.k}
                          fill={CURRENT_COLOR}
                          opacity={NODE_LABEL_OPACITY}
                        >
                          {n.label.length > NODE_LABEL_MAX_LENGTH
                            ? `${n.label.slice(0, NODE_LABEL_MAX_LENGTH - 1)}…`
                            : n.label}
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
