import { useState, useMemo } from "react";
import Mermaid from "react-mermaid2";
import { useGetProjectGraph } from "@workspace/api-client-react";
import { useTheme } from "next-themes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

interface ArchitectureFlowchartProps {
  projectId: number;
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

    let chart = "flowchart LR\n";

    // Common styling
    const defaultClass = `classDef default fill:${theme === "dark" ? "#1e293b" : "#f1f5f9"},stroke:${theme === "dark" ? "#334155" : "#cbd5e1"},stroke-width:1px,color:${theme === "dark" ? "#f8fafc" : "#0f172a"};\n`;
    const highlightClass = `classDef highlight fill:${theme === "dark" ? "#3b82f6" : "#bfdbfe"},stroke:${theme === "dark" ? "#2563eb" : "#60a5fa"},stroke-width:2px,color:${theme === "dark" ? "#f8fafc" : "#0f172a"};\n`;
    const moonClass = `classDef moon fill:${theme === "dark" ? "#475569" : "#e2e8f0"},stroke:${theme === "dark" ? "#64748b" : "#cbd5e1"},stroke-width:1px,color:${theme === "dark" ? "#f8fafc" : "#0f172a"};\n`;

    chart += defaultClass + highlightClass + moonClass + "\n";

    if (selectedL2 !== null) {
      // LEVEL 3: Show specific L2 and its L3 decisions
      const l2Node = graphData.l2Nodes?.find((n: any) => n.id === selectedL2);
      if (!l2Node) return "";

      const l3Nodes = (graphData.l3Nodes || []).filter((n: any) => n.l2NodeId === selectedL2);

      chart += `  L2_FOCUS("${l2Node.name}"):::highlight\n`;

      l3Nodes.forEach((n: any) => {
        // Sanitize string for Mermaid
        const safeTitle = n.title.replace(/["\n\r|]/g, " ").substring(0, 60);
        chart += `  L3_${n.id}("${safeTitle}"):::moon\n`;
        chart += `  L2_FOCUS -->|"${n.nodeType}"| L3_${n.id}\n`;
      });

      if (l3Nodes.length === 0) {
        chart += `  EMPTY("No decisions/rules documented yet"):::moon\n`;
        chart += `  L2_FOCUS -.-> EMPTY\n`;
      }
    } else if (selectedL1 !== null) {
      // LEVEL 2: Show specific L1 domain and its L2 modules
      const l1Node = graphData.l1Tags?.find((n: any) => n.id === selectedL1);
      if (!l1Node) return "";

      const l2Nodes = (graphData.l2Nodes || []).filter((n: any) =>
        (n.l1TagIds || []).includes(selectedL1)
      );
      const l2Ids = new Set(l2Nodes.map((n: any) => n.id));

      chart += `  subgraph DOMAIN ["Domain: ${l1Node.name}"]\n`;
      l2Nodes.forEach((n: any) => {
        chart += `    L2_${n.id}("${n.name}")\n`;
      });
      chart += `  end\n`;

      // Edges only between L2s inside this domain to avoid chart explosion
      ((graphData as any).nodeLinks || []).forEach((link: any) => {
        if (l2Ids.has(link.sourceNodeId) && l2Ids.has(link.targetNodeId)) {
          chart += `  L2_${link.sourceNodeId} -->|"${link.linkType || "calls"}"| L2_${link.targetNodeId}\n`;
        }
      });

      if (l2Nodes.length === 0) {
        chart += `  EMPTY("No components in this domain"):::moon\n`;
      }
    } else {
      // LEVEL 1: GLOBAL ARCHITECTURE (L1 to L1 interactions)
      const l1Map = new Map((graphData.l1Tags || []).map((tag: any) => [tag.id, tag.name]));
      const l1Edges = new Map<string, number>();

      const l2ToL1 = new Map<number, number[]>();
      (graphData.l2Nodes || []).forEach((n: any) => l2ToL1.set(n.id, n.l1TagIds || []));

      ((graphData as any).nodeLinks || []).forEach((link: any) => {
        const sourceL1s = l2ToL1.get(link.sourceNodeId) || [];
        const targetL1s = l2ToL1.get(link.targetNodeId) || [];

        sourceL1s.forEach((sL1) => {
          targetL1s.forEach((tL1) => {
            if (sL1 !== tL1) {
              const key = `${sL1}_${tL1}`;
              l1Edges.set(key, (l1Edges.get(key) || 0) + 1);
            }
          });
        });
      });

      l1Map.forEach((name, id) => {
        chart += `  L1_${id}(["${name}"]):::highlight\n`;
      });

      l1Edges.forEach((count, key) => {
        const [s, t] = key.split("_");
        chart += `  L1_${s} -->|"${count} deps"| L1_${t}\n`;
      });

      if (l1Map.size === 0) {
        chart += `  EMPTY("No domains extracted yet"):::moon\n`;
      }
    }

    return chart;
  }, [graphData, theme, selectedL1, selectedL2]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        Loading architecture...
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
          Global Architecture
        </Button>

        <div className="text-muted-foreground text-sm">→</div>

        <Select
          value={selectedL1?.toString() || ""}
          onValueChange={(v) => {
            setSelectedL1(parseInt(v));
            setSelectedL2(null);
          }}
        >
          <SelectTrigger className="w-[200px] h-8 text-sm">
            <SelectValue placeholder="Focus Domain (L1)..." />
          </SelectTrigger>
          <SelectContent>
            {(graphData?.l1Tags || []).map((tag: any) => (
              <SelectItem key={tag.id} value={tag.id.toString()}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedL1 !== null && (
          <>
            <div className="text-muted-foreground text-sm">→</div>
            <Select
              value={selectedL2?.toString() || ""}
              onValueChange={(v) => setSelectedL2(parseInt(v))}
            >
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <SelectValue placeholder="Focus Component (L2)..." />
              </SelectTrigger>
              <SelectContent>
                {(graphData?.l2Nodes || [])
                  .filter((n: any) => (n.l1TagIds || []).includes(selectedL1))
                  .map((n: any) => (
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
          <div className="text-muted-foreground m-auto">No data available</div>
        )}
      </div>
    </div>
  );
}
