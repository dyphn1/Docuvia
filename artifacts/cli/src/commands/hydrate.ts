import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

/** Thin caller of `docuviaApi.hydrate()` — mirrors `snapshot.ts`'s Presentation-layer responsibilities. */
export async function hydrateCommand(cwd: string = process.cwd()) {
  const spinner = ui.spinner(UI_MESSAGES.HYDRATE_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);

  try {
    const result = await docuviaApi.hydrate(scopeId, logger);
    if (!result.hydrated) {
      spinner.warn(UI_MESSAGES.HYDRATE_NOTHING);
      return;
    }
    spinner.succeed(
      `${UI_MESSAGES.HYDRATE_SUCCESS}${result.nodesLoaded}${UI_MESSAGES.HYDRATE_NODES_LOADED}${result.edgesLoaded}${UI_MESSAGES.HYDRATE_EDGES_LOADED}` +
        (result.edgesDropped > 0
          ? `${UI_MESSAGES.HYDRATE_EDGES_DROPPED_PREFIX}${result.edgesDropped}${UI_MESSAGES.HYDRATE_EDGES_DROPPED_SUFFIX}`
          : ""),
    );
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.HYDRATE_FAIL + message);
    // process.exitCode (not process.exit()) — process.exit() terminates before the `finally`
    // below runs, silently skipping the memory-scope cleanup. See publish.ts's comment for the
    // matching reason this pattern is required everywhere in this file's family of commands.
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
