import * as fs from "fs";
import * as path from "path";
import process from "process";
import { TopologyExportService, TopologyCollapseMode } from "@workspace/core";
import { renderTopologyHtml } from "./topology-html-template.js";

export interface ExportTopologyOptions {
  /** Output directory (default: <workspaceRoot>/.docuvia) */
  out?: string;
  /** Write topology.json only, skip the HTML viewer */
  jsonOnly?: boolean;
  collapse?: TopologyCollapseMode;
  /** Overridable for tests; defaults to process.cwd() */
  workspaceRoot?: string;
}

export async function exportTopologyCommand(options: ExportTopologyOptions = {}): Promise<void> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  const service = new TopologyExportService(workspaceRoot);
  const graph = service.exportTopology({ collapse: options.collapse });

  const outDir = options.out ?? path.join(workspaceRoot, ".docuvia");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "topology.json");
  fs.writeFileSync(jsonPath, JSON.stringify(graph, null, 2));
  console.log(
    `[docuvia] Wrote ${jsonPath} (${graph.stats.nodeCount} nodes, ${graph.stats.linkCount} links, ${graph.stats.groupCount} groups${graph.collapsed ? ", collapsed to file level" : ""})`
  );

  if (!options.jsonOnly) {
    const htmlPath = path.join(outDir, "topology.html");
    fs.writeFileSync(htmlPath, renderTopologyHtml(graph));
    console.log(`[docuvia] Wrote ${htmlPath} — open it in any browser (works fully offline)`);
  }
}
