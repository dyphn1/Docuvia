import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useGetProjectGraph } from "@workspace/api-client-react";
import { useTheme } from "next-themes";

interface ProjectTopologyGraphProps {
  projectId: number;
}

export function ProjectTopologyGraph({ projectId }: ProjectTopologyGraphProps) {
  const { theme } = useTheme();
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const { data: graphData, isLoading } = useGetProjectGraph(projectId, {
    query: {
      enabled: !!projectId,
    } as any
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
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
    return undefined;
  }, []);

  const formattedData = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };

    // Grouping L2 Nodes and linking L1 tags
    // The data format depends on what the `/projects/:id/graph` endpoint returns.
    // Based on previous contexts, it likely returns `nodes` and `links`.
    
    // We will apply colors based on L1 tag domains or types.
    const nodes: any[] = [];
    const links: any[] = [];

    // 1. Add L1 Tags (Suns)
    (graphData.l1Tags || []).forEach((tag: any) => {
      nodes.push({
        id: `l1_${tag.id}`,
        name: tag.name,
        val: 35, // Giant
        level: 1,
        color: theme === 'dark' ? '#fde047' : '#eab308', // yellow
      });
    });

    // 2. Add L2 Nodes (Planets)
    (graphData.l2Nodes || []).forEach((node: any) => {
      nodes.push({
        id: `l2_${node.id}`,
        name: node.name,
        val: 15, // Planet
        level: 2,
        color: theme === 'dark' ? '#60a5fa' : '#3b82f6', // blue
      });

      // Link L2 to its L1s
      (node.l1TagIds || []).forEach((tagId: any) => {
        links.push({
          source: `l2_${node.id}`,
          target: `l1_${tagId}`,
          label: "belongs_to",
          color: theme === 'dark' ? 'rgba(253, 224, 71, 0.4)' : 'rgba(234, 179, 8, 0.4)',
        });
      });
    });

    // 3. Add L3 Nodes (Moons)
    (graphData.l3Nodes || []).forEach((node: any) => {
      nodes.push({
        id: `l3_${node.id}`,
        name: node.title,
        val: 5, // Moon
        level: 3,
        color: theme === 'dark' ? '#94a3b8' : '#64748b', // slate
      });

      // Link L3 to L2
      links.push({
        source: `l3_${node.id}`,
        target: `l2_${node.l2NodeId}`,
        label: "implements",
        color: theme === 'dark' ? 'rgba(148, 163, 184, 0.4)' : 'rgba(100, 116, 139, 0.4)',
      });
    });

    // 4. Add L2-to-L2 Node Links (Dependencies/Calls)
    ((graphData as any).nodeLinks || []).forEach((link: any) => {
      links.push({
        source: `l2_${link.sourceNodeId}`,
        target: `l2_${link.targetNodeId}`,
        label: link.linkType || "calls",
        color: theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
      });
    });

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
          
          // Only draw text if we're zoomed in enough or it's a giant sun
          if (globalScale > 1.5 || node.level === 1) {
            ctx.fillStyle = theme === 'dark' ? '#e2e8f0' : '#1e293b';
            if (node.level === 1) ctx.font = `bold ${fontSize + 2}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, node.x, node.y + node.val + 6);
          }
          
          // Draw the circle
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.val || 5, 0, 2 * Math.PI, false);
          
          // Add glow effect for L1 (Sun)
          if (node.level === 1) {
            ctx.shadowBlur = 15;
            ctx.shadowColor = node.color;
          } else {
            ctx.shadowBlur = 0;
          }
          
          ctx.fillStyle = node.color;
          ctx.fill();
        }}
      />
    </div>
  );
}
