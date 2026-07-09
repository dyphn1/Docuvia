import * as fs from "fs";
import * as path from "path";
import process from "process";
import {
  TopologyExportService,
  TopologyCollapseMode,
  DI_TOKENS,
  DI_KEYS,
  DOCUVIA_DIR_NAME,
} from "@workspace/core";
import { renderTopologyHtml } from "./topology-html-template.js";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { TOPOLOGY_JSON_FILENAME, TOPOLOGY_HTML_FILENAME } from "../constants/docuvia-paths.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

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
    const service = resolveConfiguredService<TopologyExportService>(
      DI_TOKENS.TopologyExportService,
      { [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot }
    );

    const graph = service.exportTopology({ collapse: options.collapse });

    const outDir = options.out ?? path.join(workspaceRoot, DOCUVIA_DIR_NAME);
    fs.mkdirSync(outDir, { recursive: true });

    const jsonPath = path.join(outDir, TOPOLOGY_JSON_FILENAME);
    fs.writeFileSync(jsonPath, JSON.stringify(graph, null, 2));

    let successMessage = `${UI_MESSAGES.EXPORT_SUCCESS}${jsonPath} (${graph.stats.nodeCount} nodes, ${graph.stats.linkCount} links, ${graph.stats.groupCount} groups${graph.collapsed ? ", collapsed" : ""})`;

    if (!options.jsonOnly) {
      const htmlPath = path.join(outDir, TOPOLOGY_HTML_FILENAME);
      fs.writeFileSync(htmlPath, renderTopologyHtml(graph));
      successMessage += ` and ${htmlPath}`;
    }
    spinner.succeed(successMessage);
  } catch (error: any) {
    spinner.fail(UI_MESSAGES.EXPORT_FAIL + error.message);
    throw error;
  }
}
