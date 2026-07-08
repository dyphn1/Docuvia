import * as fs from "fs";
import * as path from "path";
import process from "process";
import {
  TopologyExportService,
  TopologyCollapseMode,
  DI_TOKENS,
  DI_KEYS,
  container,
} from "@workspace/core";
import { renderTopologyHtml } from "./topology-html-template.js";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

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
  const spinner = ui.spinner(UI_MESSAGES.EXPORT_START).start();

  try {
    const service = container.resolve<TopologyExportService>(DI_TOKENS.TopologyExportService);
    (service as any)[DI_KEYS.WORKSPACE_ROOT] = workspaceRoot;

    const graph = service.exportTopology({ collapse: options.collapse });

    const outDir = options.out ?? path.join(workspaceRoot, ".docuvia");
    fs.mkdirSync(outDir, { recursive: true });

    const jsonPath = path.join(outDir, "topology.json");
    fs.writeFileSync(jsonPath, JSON.stringify(graph, null, 2));

    let successMessage = `${UI_MESSAGES.EXPORT_SUCCESS}${jsonPath} (${graph.stats.nodeCount} nodes, ${graph.stats.linkCount} links, ${graph.stats.groupCount} groups${graph.collapsed ? ", collapsed" : ""})`;

    if (!options.jsonOnly) {
      const htmlPath = path.join(outDir, "topology.html");
      fs.writeFileSync(htmlPath, renderTopologyHtml(graph));
      successMessage += ` and ${htmlPath}`;
    }
    spinner.succeed(successMessage);
  } catch (error: any) {
    spinner.fail(UI_MESSAGES.EXPORT_FAIL + error.message);
    process.exit(1);
  }
}
