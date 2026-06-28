import { useMemo } from "react";
import Mermaid from "react-mermaid2";
import { useGetProjectGraph } from "@workspace/api-client-react";
import { useTheme } from "next-themes";

interface ArchitectureFlowchartProps {
  projectId: number;
}

export function ArchitectureFlowchart({ projectId }: ArchitectureFlowchartProps) {
  const { theme } = useTheme();

  const { data: graphData, isLoading } = useGetProjectGraph(projectId, {
    query: {
      enabled: !!projectId,
    }
  });

  const mermaidChart = useMemo(() => {
    if (!graphData || (!graphData.l1Tags?.length && !graphData.l2Nodes?.length)) return "";

    let chart = "flowchart LR\n";

    // Create subgraphs for L1 Tags
    const l1Map = new Map((graphData.l1Tags || []).map((tag: any) => [tag.id, tag.name]));
    
    // Track which L2 nodes are assigned to which L1
    const l1ToL2 = new Map<number, any[]>();
    const unassignedL2: any[] = [];

    (graphData.l2Nodes || []).forEach((node: any) => {
      if (node.l1TagIds && node.l1TagIds.length > 0) {
        node.l1TagIds.forEach((tagId: number) => {
          if (!l1ToL2.has(tagId)) l1ToL2.set(tagId, []);
          l1ToL2.get(tagId)?.push(node);
        });
      } else {
        unassignedL2.push(node);
      }
    });

    // Render Subgraphs (L1 Tags acting as structural boxes)
    for (const [tagId, nodes] of l1ToL2.entries()) {
      const tagName = l1Map.get(tagId) || \`Domain_\${tagId}\`;
      chart += \`  subgraph L1_\${tagId} ["\${tagName}"]\n\`;
      nodes.forEach((n) => {
        chart += \`    L2_\${n.id}("\${n.name}")\n\`;
      });
      chart += \`  end\n\`;
    }

    // Render unassigned L2 nodes
    unassignedL2.forEach((n) => {
      chart += \`  L2_\${n.id}("\${n.name}")\n\`;
    });

    // Render Edges (Calls/Dependencies)
    (graphData.nodeLinks || []).forEach((link: any) => {
      chart += \`  L2_\${link.sourceNodeId} -->|"\${link.linkType || 'calls'}"| L2_\${link.targetNodeId}\n\`;
    });

    // Apply some styling
    chart += \`\n  classDef default fill:\${theme === 'dark' ? '#1e293b' : '#f1f5f9'},stroke:\${theme === 'dark' ? '#334155' : '#cbd5e1'},stroke-width:1px,color:\${theme === 'dark' ? '#f8fafc' : '#0f172a'}\n\`;

    return chart;
  }, [graphData, theme]);

  if (isLoading) {
    return <div className="w-full h-full flex items-center justify-center text-muted-foreground">Loading architecture...</div>;
  }

  if (!mermaidChart) {
    return <div className="w-full h-full flex items-center justify-center text-muted-foreground">No architecture data available.</div>;
  }

  return (
    <div className="w-full h-full min-h-[600px] overflow-auto bg-background p-4 flex justify-center border rounded-md">
      <Mermaid chart={mermaidChart} />
    </div>
  );
}