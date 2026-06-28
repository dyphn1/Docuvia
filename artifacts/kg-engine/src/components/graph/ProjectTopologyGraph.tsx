import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useGetProjectGraph } from "@workspace/api-client-react";
import { useTheme } from "next-themes";

interface ProjectTopologyGraphProps {
  projectId: number;
}

export function ProjectTopologyGraph({ projectId }: ProjectTopologyGraphProps) {
  const { theme } = useTheme();
  const graphRef = useRef<any>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const { data: graphData, isLoading } = useGetProjectGraph(projectId, {
    query: {
      enabled: !!projectId,
    }
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
      
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  const formattedData = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };

    // Grouping L2 Nodes and linking L1 tags
    // The data format depends on what the `/projects/:id/graph` endpoint returns.
    // Based on previous contexts, it likely returns `nodes` and `links`.
    
    // We will apply colors based on L1 tag domains or types.
    const nodes = [
      ...(graphData.l2Nodes || []).map((node: any) => ({
        ...node,
        val: node.type === 'file' ? 10 : (node.type === 'function' ? 5 : 15),
        color: theme === 'dark' ? '#60a5fa' : '#3b82f6', // default blue
      }))
    ];
    
    const links = (graphData.nodeLinks || []).map((link: any) => ({
      source: link.sourceNodeId,
      target: link.targetNodeId,
      label: link.linkType || "calls",
      color: theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
    }));

    return { nodes, links };
  }, [graphData, theme]);

  const handleNodeClick = useCallback((node: any) => {
    // Implement zoom or details panel on click
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 1000);
      graphRef.current.zoom(8, 2000);
    }
  }, []);

  if (isLoading) {
    return <div className="w-full h-full flex items-center justify-center text-muted-foreground">Loading topology...</div>;
  }

  if (!formattedData.nodes.length) {
    return <div className="w-full h-full flex items-center justify-center text-muted-foreground">No topology data available. Ensure the AST parser has run.</div>;
  }

  return (
    <div ref={containerRef} className="w-full h-full min-h-[600px] border rounded-md overflow-hidden bg-background">
      <ForceGraph2D
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={formattedData}
        nodeId="id"
        nodeLabel="name"
        nodeColor="color"
        nodeRelSize={6}
        linkColor="color"
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        backgroundColor={theme === 'dark' ? '#0f172a' : '#f8fafc'} // slate-900 or slate-50
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          const label = node.name;
          const fontSize = 12 / globalScale;
          ctx.font = `${fontSize}px Sans-Serif`;
          
          // Only draw text if we're zoomed in enough
          if (globalScale > 2) {
            ctx.fillStyle = theme === 'dark' ? '#e2e8f0' : '#1e293b';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, node.x, node.y + 8);
          }
          
          // Draw the circle
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.val || 5, 0, 2 * Math.PI, false);
          ctx.fillStyle = node.color;
          ctx.fill();
        }}
      />
    </div>
  );
}
