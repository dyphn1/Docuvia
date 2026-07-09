import { useState, useMemo } from "react";
import Mermaid from "react-mermaid2";
import {
  useGetProjectGraph,
  type L1Tag,
  type L2Node,
  type L3Node,
  type ProjectGraph,
} from "@workspace/api-client-react";
import { useTheme } from "next-themes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import {
  THEME_DARK,
  LOADING_MESSAGE,
  NO_DATA_MESSAGE,
  GLOBAL_ARCHITECTURE_LABEL,
  FOCUS_DOMAIN_PLACEHOLDER,
  FOCUS_COMPONENT_PLACEHOLDER,
  BREADCRUMB_SEPARATOR,
  FOCUS_SELECT_TRIGGER_CLASS,
  MERMAID_UNSAFE_CHARS_REGEX,
  MAX_NODE_TITLE_LENGTH,
  DEFAULT_LINK_TYPE,
  CHART_THEME_COLORS,
  MERMAID_CHART_HEADER,
  MERMAID_CLASS_DEFAULT,
  MERMAID_CLASS_HIGHLIGHT,
  MERMAID_CLASS_MOON,
  MERMAID_STROKE_WIDTH_THIN,
  MERMAID_STROKE_WIDTH_THICK,
  L2_FOCUS_NODE_ID,
  DOMAIN_SUBGRAPH_ID,
  EMPTY_NODE_ID,
  DEPENDENCY_COUNT_UNIT,
  DOMAIN_LABEL_PREFIX,
  EMPTY_L3_MESSAGE,
  EMPTY_L2_MESSAGE,
  EMPTY_L1_MESSAGE,
} from "@/constants/mermaid";

interface ArchitectureFlowchartProps {
  projectId: number;
}

/** L2-to-L2 dependency edges. Not yet part of the generated `ProjectGraph` schema, though the API returns it. */
interface NodeLink {
  sourceNodeId: number;
  targetNodeId: number;
  linkType?: string;
}

type ProjectGraphWithLinks = ProjectGraph & { nodeLinks?: NodeLink[] };

function getNodeLinks(graphData: ProjectGraphWithLinks | undefined): NodeLink[] {
  return graphData?.nodeLinks ?? [];
}

const l1NodeId = (id: number) => `L1_${id}`;
const l2NodeId = (id: number) => `L2_${id}`;
const l3NodeId = (id: number) => `L3_${id}`;

function mermaidRoundNode(id: string, label: string, className?: string): string {
  return className ? `  ${id}("${label}"):::${className}\n` : `  ${id}("${label}")\n`;
}

function mermaidStadiumNode(id: string, label: string, className?: string): string {
  return className ? `  ${id}(["${label}"]):::${className}\n` : `  ${id}(["${label}"])\n`;
}

function mermaidEdge(fromId: string, toId: string, label: string): string {
  return `  ${fromId} -->|"${label}"| ${toId}\n`;
}

function mermaidDashedEdge(fromId: string, toId: string): string {
  return `  ${fromId} -.-> ${toId}\n`;
}

function buildClassDefs(theme: string | undefined): string {
  const c = theme === THEME_DARK ? CHART_THEME_COLORS.dark : CHART_THEME_COLORS.light;
  return (
    `classDef ${MERMAID_CLASS_DEFAULT} fill:${c.defaultFill},stroke:${c.defaultStroke},stroke-width:${MERMAID_STROKE_WIDTH_THIN},color:${c.text};\n` +
    `classDef ${MERMAID_CLASS_HIGHLIGHT} fill:${c.highlightFill},stroke:${c.highlightStroke},stroke-width:${MERMAID_STROKE_WIDTH_THICK},color:${c.text};\n` +
    `classDef ${MERMAID_CLASS_MOON} fill:${c.moonFill},stroke:${c.moonStroke},stroke-width:${MERMAID_STROKE_WIDTH_THIN},color:${c.text};\n\n`
  );
}

// LEVEL 3: Show a specific L2 module and its L3 decisions/rules
function buildL3FocusChart(l2Node: L2Node, l3Nodes: L3Node[]): string {
  let chart = mermaidRoundNode(L2_FOCUS_NODE_ID, l2Node.name, MERMAID_CLASS_HIGHLIGHT);

  l3Nodes.forEach((n) => {
    const safeTitle = n.title
      .replace(MERMAID_UNSAFE_CHARS_REGEX, " ")
      .substring(0, MAX_NODE_TITLE_LENGTH);
    const nodeId = l3NodeId(n.id);
    chart += mermaidRoundNode(nodeId, safeTitle, MERMAID_CLASS_MOON);
    chart += mermaidEdge(L2_FOCUS_NODE_ID, nodeId, n.nodeType);
  });

  if (l3Nodes.length === 0) {
    chart += mermaidRoundNode(EMPTY_NODE_ID, EMPTY_L3_MESSAGE, MERMAID_CLASS_MOON);
    chart += mermaidDashedEdge(L2_FOCUS_NODE_ID, EMPTY_NODE_ID);
  }

  return chart;
}

// LEVEL 2: Show a specific L1 domain and its L2 modules
function buildL2FocusChart(l1Node: L1Tag, l2Nodes: L2Node[], nodeLinks: NodeLink[]): string {
  const l2Ids = new Set(l2Nodes.map((n) => n.id));
  let chart = `  subgraph ${DOMAIN_SUBGRAPH_ID} ["${DOMAIN_LABEL_PREFIX}${l1Node.name}"]\n`;
  l2Nodes.forEach((n) => {
    chart += `    ${l2NodeId(n.id)}("${n.name}")\n`;
  });
  chart += `  end\n`;

  // Edges only between L2s inside this domain to avoid chart explosion
  nodeLinks.forEach((link) => {
    if (l2Ids.has(link.sourceNodeId) && l2Ids.has(link.targetNodeId)) {
      chart += mermaidEdge(
        l2NodeId(link.sourceNodeId),
        l2NodeId(link.targetNodeId),
        link.linkType || DEFAULT_LINK_TYPE
      );
    }
  });

  if (l2Nodes.length === 0) {
    chart += mermaidRoundNode(EMPTY_NODE_ID, EMPTY_L2_MESSAGE, MERMAID_CLASS_MOON);
  }

  return chart;
}

// LEVEL 1: GLOBAL ARCHITECTURE (L1 to L1 interactions)
function buildGlobalArchitectureChart(
  l1Tags: L1Tag[],
  l2Nodes: L2Node[],
  nodeLinks: NodeLink[]
): string {
  const l1Map = new Map(l1Tags.map((tag) => [tag.id, tag.name]));
  const l2ToL1 = new Map<number, number[]>();
  l2Nodes.forEach((n) => l2ToL1.set(n.id, n.l1TagIds || []));

  // Nested map keyed by numeric ids (rather than a concatenated "source_target"
  // string key) tracks dependency counts per L1-to-L1 pair; a parallel order
  // list preserves first-seen edge order for stable chart output.
  const l1DependencyCounts = new Map<number, Map<number, number>>();
  const l1DependencyOrder: Array<[number, number]> = [];

  nodeLinks.forEach((link) => {
    const sourceL1s = l2ToL1.get(link.sourceNodeId) || [];
    const targetL1s = l2ToL1.get(link.targetNodeId) || [];

    sourceL1s.forEach((sourceL1) => {
      targetL1s.forEach((targetL1) => {
        if (sourceL1 === targetL1) return;

        let targets = l1DependencyCounts.get(sourceL1);
        if (!targets) {
          targets = new Map<number, number>();
          l1DependencyCounts.set(sourceL1, targets);
        }
        if (!targets.has(targetL1)) {
          l1DependencyOrder.push([sourceL1, targetL1]);
        }
        targets.set(targetL1, (targets.get(targetL1) ?? 0) + 1);
      });
    });
  });

  let chart = "";
  l1Map.forEach((name, id) => {
    chart += mermaidStadiumNode(l1NodeId(id), name, MERMAID_CLASS_HIGHLIGHT);
  });

  l1DependencyOrder.forEach(([sourceL1, targetL1]) => {
    const count = l1DependencyCounts.get(sourceL1)?.get(targetL1) ?? 0;
    chart += mermaidEdge(
      l1NodeId(sourceL1),
      l1NodeId(targetL1),
      `${count} ${DEPENDENCY_COUNT_UNIT}`
    );
  });

  if (l1Map.size === 0) {
    chart += mermaidRoundNode(EMPTY_NODE_ID, EMPTY_L1_MESSAGE, MERMAID_CLASS_MOON);
  }

  return chart;
}

export function ArchitectureFlowchart({ projectId }: ArchitectureFlowchartProps) {
  const { theme } = useTheme();

  const [selectedL1, setSelectedL1] = useState<number | null>(null);
  const [selectedL2, setSelectedL2] = useState<number | null>(null);

  const { data: graphData, isLoading } = useGetProjectGraph(projectId, {
    query: {
      enabled: !!projectId,
    } as any,
  });

  const mermaidChart = useMemo(() => {
    if (!graphData) return "";

    let chart = MERMAID_CHART_HEADER + buildClassDefs(theme);
    const nodeLinks = getNodeLinks(graphData as ProjectGraphWithLinks);

    if (selectedL2 !== null) {
      const l2Node = graphData.l2Nodes?.find((n) => n.id === selectedL2);
      if (!l2Node) return "";

      const l3Nodes = (graphData.l3Nodes || []).filter((n) => n.l2NodeId === selectedL2);
      chart += buildL3FocusChart(l2Node, l3Nodes);
    } else if (selectedL1 !== null) {
      const l1Node = graphData.l1Tags?.find((n) => n.id === selectedL1);
      if (!l1Node) return "";

      const l2Nodes = (graphData.l2Nodes || []).filter((n) =>
        (n.l1TagIds || []).includes(selectedL1)
      );
      chart += buildL2FocusChart(l1Node, l2Nodes, nodeLinks);
    } else {
      chart += buildGlobalArchitectureChart(
        graphData.l1Tags || [],
        graphData.l2Nodes || [],
        nodeLinks
      );
    }

    return chart;
  }, [graphData, theme, selectedL1, selectedL2]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        {LOADING_MESSAGE}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-h-[600px] border rounded-md overflow-hidden bg-background">
      <div className="flex flex-wrap gap-2 items-center p-4 border-b bg-card/50">
        <Button
          variant={selectedL1 === null ? "default" : "outline"}
          onClick={() => {
            setSelectedL1(null);
            setSelectedL2(null);
          }}
          size="sm"
        >
          {GLOBAL_ARCHITECTURE_LABEL}
        </Button>

        <div className="text-muted-foreground text-sm">{BREADCRUMB_SEPARATOR}</div>

        <Select
          value={selectedL1?.toString() || ""}
          onValueChange={(v) => {
            setSelectedL1(parseInt(v));
            setSelectedL2(null);
          }}
        >
          <SelectTrigger className={FOCUS_SELECT_TRIGGER_CLASS}>
            <SelectValue placeholder={FOCUS_DOMAIN_PLACEHOLDER} />
          </SelectTrigger>
          <SelectContent>
            {(graphData?.l1Tags || []).map((tag) => (
              <SelectItem key={tag.id} value={tag.id.toString()}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedL1 !== null && (
          <>
            <div className="text-muted-foreground text-sm">{BREADCRUMB_SEPARATOR}</div>
            <Select
              value={selectedL2?.toString() || ""}
              onValueChange={(v) => setSelectedL2(parseInt(v))}
            >
              <SelectTrigger className={FOCUS_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder={FOCUS_COMPONENT_PLACEHOLDER} />
              </SelectTrigger>
              <SelectContent>
                {(graphData?.l2Nodes || [])
                  .filter((n) => (n.l1TagIds || []).includes(selectedL1))
                  .map((n) => (
                    <SelectItem key={n.id} value={n.id.toString()}>
                      {n.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6 flex justify-center bg-card/10">
        {mermaidChart ? (
          <Mermaid chart={mermaidChart} />
        ) : (
          <div className="text-muted-foreground m-auto">{NO_DATA_MESSAGE}</div>
        )}
      </div>
    </div>
  );
}
