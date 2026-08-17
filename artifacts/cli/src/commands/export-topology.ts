import fs from "fs/promises";
import path from "path";
import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  DOCUVIA_DIR_NAME,
  type TopologyCollapseMode,
  type TopologyGraph,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { renderTopologyHtml } from "./topology-html-template.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import {
  TOPOLOGY_JSON_FILENAME,
  TOPOLOGY_HTML_FILENAME,
} from "../constants/docuvia-paths.js";

export interface ExportTopologyOptions {
  /** Output directory (default: <workspaceRoot>/.docuvia) */
  out?: string;
  /** Write topology.json only, skip the HTML viewer */
  jsonOnly?: boolean;
  collapse?: TopologyCollapseMode;
}

/** Prints the export's stats/paths as separate lines instead of one run-on sentence -- mirrors
 *  hydrate/snapshot's spinner-succeeds-with-a-short-message-then-details-below convention. */
function printExportDetails(graph: TopologyGraph, htmlPath?: string): void {
  ui.info(
    UI_MESSAGES.EXPORT_STATS_LINE(
      graph.stats.nodeCount,
      graph.stats.linkCount,
      graph.stats.groupCount,
    ),
  );
  if (graph.collapsed) ui.info(UI_MESSAGES.EXPORT_COLLAPSED_LINE);
  if (graph.stats.foldedLinkCount > 0) {
    ui.info(UI_MESSAGES.EXPORT_FOLDED_LINE(graph.stats.foldedLinkCount));
  }
  if (htmlPath) ui.info(UI_MESSAGES.EXPORT_HTML_PATH_LINE(htmlPath));
}

/** Thin caller of docuviaApi.exportTopology() - mirrors init.ts's Presentation-layer responsibilities. */
export async function exportTopologyCommand(
  options: ExportTopologyOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  ui.header(UI_MESSAGES.EXPORT_HEADER);
  const spinner = ui.spinner(UI_MESSAGES.EXPORT_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  if (options.collapse)
    docuviaMemory.set(scopeId, MemoryKeys.COLLAPSE, options.collapse);

  try {
    const graph = await docuviaApi.exportTopology(scopeId, logger);

    const outDir = options.out ?? path.join(cwd, DOCUVIA_DIR_NAME);
    // Issue #71: async fs APIs — the sync variants block the event loop on every export.
    await fs.mkdir(outDir, { recursive: true });

    const jsonPath = path.join(outDir, TOPOLOGY_JSON_FILENAME);
    await fs.writeFile(jsonPath, JSON.stringify(graph, null, 2));

    let htmlPath: string | undefined;
    if (!options.jsonOnly) {
      htmlPath = path.join(outDir, TOPOLOGY_HTML_FILENAME);
      await fs.writeFile(htmlPath, renderTopologyHtml(graph));
    }

    spinner.succeed(UI_MESSAGES.EXPORT_SUCCESS + jsonPath);
    printExportDetails(graph, htmlPath);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.EXPORT_FAIL + message);
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
