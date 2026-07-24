import fs from "fs";
import path from "path";
import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  DOCUVIA_DIR_NAME,
  type TopologyCollapseMode,
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

/** Thin caller of docuviaApi.exportTopology() - mirrors init.ts's Presentation-layer responsibilities. */
export async function exportTopologyCommand(
  options: ExportTopologyOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
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
    fs.mkdirSync(outDir, { recursive: true });

    const jsonPath = path.join(outDir, TOPOLOGY_JSON_FILENAME);
    fs.writeFileSync(jsonPath, JSON.stringify(graph, null, 2));

    let successMessage =
      UI_MESSAGES.EXPORT_SUCCESS +
      jsonPath +
      UI_MESSAGES.EXPORT_STATS_PREFIX +
      graph.stats.nodeCount +
      UI_MESSAGES.EXPORT_STATS_NODES +
      graph.stats.linkCount +
      UI_MESSAGES.EXPORT_STATS_LINKS +
      graph.stats.groupCount +
      UI_MESSAGES.EXPORT_STATS_GROUPS +
      (graph.collapsed ? UI_MESSAGES.EXPORT_STATS_COLLAPSED : "") +
      UI_MESSAGES.EXPORT_STATS_SUFFIX;

    if (graph.stats.foldedLinkCount > 0) {
      successMessage +=
        UI_MESSAGES.EXPORT_STATS_FOLDED_PREFIX +
        graph.stats.foldedLinkCount +
        UI_MESSAGES.EXPORT_STATS_FOLDED_SUFFIX;
    }

    if (!options.jsonOnly) {
      const htmlPath = path.join(outDir, TOPOLOGY_HTML_FILENAME);
      fs.writeFileSync(htmlPath, renderTopologyHtml(graph));
      successMessage += UI_MESSAGES.EXPORT_HTML_SEPARATOR + htmlPath;
    }
    spinner.succeed(successMessage);
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
