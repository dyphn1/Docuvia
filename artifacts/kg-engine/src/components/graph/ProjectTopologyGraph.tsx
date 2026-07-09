import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useGetProjectGraph, type ProjectGraph } from "@workspace/api-client-react";
import { useTheme } from "next-themes";
import {
  THEME_DARK,
  FORCE_GRAPH_LOADING_MESSAGE,
  FORCE_GRAPH_NO_DATA_MESSAGE,
  DEFAULT_GRAPH_WIDTH,
  DEFAULT_GRAPH_HEIGHT,
  NODE_SIZE_L1,
  NODE_SIZE_L2,
  NODE_SIZE_L3,
  LINK_LABEL_BELONGS_TO,
  LINK_LABEL_IMPLEMENTS,
  DEFAULT_LINK_TYPE,
  NODE_REL_SIZE,
  LINK_ARROW_LENGTH,
  LINK_ARROW_REL_POS,
  NODE_CLICK_PAN_DURATION_MS,
  NODE_CLICK_ZOOM_LEVEL,
  NODE_CLICK_ZOOM_DURATION_MS,
  LABEL_BASE_FONT_SIZE_PX,
  LABEL_VISIBLE_ZOOM_THRESHOLD,
  LABEL_HIGHLIGHT_FONT_BONUS_PX,
  LABEL_Y_OFFSET_PX,
  SUN_GLOW_BLUR_PX,
  TOPOLOGY_COLORS,
} from "@/constants/topology";

interface ProjectTopologyGraphProps {
  projectId: number;
}

/** L2-to-L2 dependency edges. Not yet part of the generated `ProjectGraph` schema, though the API returns it. */
interface NodeLink {
  sourceNodeId: number;
  targetNodeId: number;
  linkType?: string;
}

type ProjectGraphWithLinks = ProjectGraph & { nodeLinks?: NodeLink[] };

interface TopologyNode {
  id: string;
  name: string;
  val: number;
  level: 1 | 2 | 3;
  color: string;
}

interface TopologyLink {
  source: string;
  target: string;
  label: string;
  color: string;
}

function getTopologyPalette(theme: string | undefined) {
  return theme === THEME_DARK ? TOPOLOGY_COLORS.dark : TOPOLOGY_COLORS.light;
}

function buildTopologyGraph(
  graphData: ProjectGraphWithLinks | undefined,
  theme: string | undefined
): { nodes: TopologyNode[]; links: TopologyLink[] } {
  if (!graphData) return { nodes: [], links: [] };

  const palette = getTopologyPalette(theme);
  const nodes: TopologyNode[] = [];
  const links: TopologyLink[] = [];

  // 1. Add L1 Tags (Suns)
  (graphData.l1Tags || []).forEach((tag) => {
    nodes.push({
      id: `l1_${tag.id}`,
      name: tag.name,
      val: NODE_SIZE_L1,
      level: 1,
      color: palette.l1,
    });
  });

  // 2. Add L2 Nodes (Planets), linked to their L1 tags
  (graphData.l2Nodes || []).forEach((node) => {
    nodes.push({
      id: `l2_${node.id}`,
      name: node.name,
      val: NODE_SIZE_L2,
      level: 2,
      color: palette.l2,
    });

    (node.l1TagIds || []).forEach((tagId) => {
      links.push({
        source: `l2_${node.id}`,
        target: `l1_${tagId}`,
        label: LINK_LABEL_BELONGS_TO,
        color: palette.l1LinkColor,
      });
    });
  });

  // 3. Add L3 Nodes (Moons), linked to their L2 module
  (graphData.l3Nodes || []).forEach((node) => {
    nodes.push({
      id: `l3_${node.id}`,
      name: node.title,
      val: NODE_SIZE_L3,
      level: 3,
      color: palette.l3,
    });

    links.push({
      source: `l3_${node.id}`,
      target: `l2_${node.l2NodeId}`,
      label: LINK_LABEL_IMPLEMENTS,
      color: palette.l3LinkColor,
    });
  });

  // 4. Add L2-to-L2 Node Links (Dependencies/Calls)
  (graphData.nodeLinks || []).forEach((link) => {
    links.push({
      source: `l2_${link.sourceNodeId}`,
      target: `l2_${link.targetNodeId}`,
      label: link.linkType || DEFAULT_LINK_TYPE,
      color: palette.l2LinkColor,
    });
  });

  return { nodes, links };
}

export function ProjectTopologyGraph({ projectId }: ProjectTopologyGraphProps) {
  const { theme } = useTheme();
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({
    width: DEFAULT_GRAPH_WIDTH,
    height: DEFAULT_GRAPH_HEIGHT,
  });

  const { data: graphData, isLoading } = useGetProjectGraph(projectId, {
    query: {
      enabled: !!projectId,
    } as any,
  });

  useEffect(() => {
    if (containerRef.current) {
      setDimensions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });

      const handleResize = () => {
        if (containerRef.current) {
          setDimensions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        }
      };

      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }
    return undefined;
  }, []);

  const formattedData = useMemo(
    () => buildTopologyGraph(graphData as ProjectGraphWithLinks | undefined, theme),
    [graphData, theme]
  );

  const handleNodeClick = useCallback((node: any) => {
    // Implement zoom or details panel on click
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, NODE_CLICK_PAN_DURATION_MS);
      graphRef.current.zoom(NODE_CLICK_ZOOM_LEVEL, NODE_CLICK_ZOOM_DURATION_MS);
    }
  }, []);

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const palette = getTopologyPalette(theme);
      const label = node.name;
      const fontSize = LABEL_BASE_FONT_SIZE_PX / globalScale;
      ctx.font = `${fontSize}px Sans-Serif`;

      // Only draw text if we're zoomed in enough or it's a giant sun
      if (globalScale > LABEL_VISIBLE_ZOOM_THRESHOLD || node.level === 1) {
        ctx.fillStyle = palette.labelText;
        if (node.level === 1) {
          ctx.font = `bold ${fontSize + LABEL_HIGHLIGHT_FONT_BONUS_PX}px Sans-Serif`;
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, node.x, node.y + node.val + LABEL_Y_OFFSET_PX);
      }

      // Draw the circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.val || NODE_SIZE_L3, 0, 2 * Math.PI, false);

      // Add glow effect for L1 (Sun)
      if (node.level === 1) {
        ctx.shadowBlur = SUN_GLOW_BLUR_PX;
        ctx.shadowColor = node.color;
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = node.color;
      ctx.fill();
    },
    [theme]
  );

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        {FORCE_GRAPH_LOADING_MESSAGE}
      </div>
    );
  }

  if (!formattedData.nodes.length) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        {FORCE_GRAPH_NO_DATA_MESSAGE}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[600px] border rounded-md overflow-hidden bg-background"
    >
      <ForceGraph2D
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={formattedData}
        nodeId="id"
        nodeLabel="name"
        nodeColor="color"
        nodeRelSize={NODE_REL_SIZE}
        linkColor="color"
        linkDirectionalArrowLength={LINK_ARROW_LENGTH}
        linkDirectionalArrowRelPos={LINK_ARROW_REL_POS}
        onNodeClick={handleNodeClick}
        backgroundColor={getTopologyPalette(theme).background}
        nodeCanvasObject={paintNode}
      />
    </div>
  );
}
