import {
  LocalOrphanBranchWriter,
  FileDiscoveryService,
  AstProcessingService,
  mapAstToEvents,
  GitNativePersistenceService,
  DI_TOKENS,
  DI_KEYS,
  GitConstants,
} from "@workspace/core";
import process from "process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

export async function snapshotCommand(workspaceRoot: string = process.cwd()) {
  const spinner = ui.spinner(UI_MESSAGES.SNAPSHOT_START).start();
  let tempDir = "";
  try {
    spinner.text = UI_MESSAGES.SNAPSHOT_DISCOVER;
    const fileDiscovery = new FileDiscoveryService();
    // Pass an empty dbPath string to skip SQLite hash checking
    const { filesToParse } = await fileDiscovery.discoverFiles(workspaceRoot, "", {
      onlyIndexed: true,
    });

    spinner.text = UI_MESSAGES.SNAPSHOT_PARSE;
    const astProcessor = new AstProcessingService();
    const parsedResults = await astProcessor.processFiles(workspaceRoot, filesToParse);

    spinner.text = UI_MESSAGES.SNAPSHOT_MAP;
    const events = mapAstToEvents(parsedResults);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docuvia-sync-"));

    spinner.text = UI_MESSAGES.SNAPSHOT_PERSIST;
    const gitNativePersistence = new GitNativePersistenceService();
    const result = {
      errors: [],
      l2Created: 0,
      l3Created: 0,
      linksCreated: 0,
      contractsCreated: 0,
      filesSkipped: 0,
    };

    await gitNativePersistence.processEvents(events, tempDir, result);

    spinner.text = UI_MESSAGES.SNAPSHOT_PACK;
    const localWriter = resolveConfiguredService<LocalOrphanBranchWriter>(
      DI_TOKENS.LocalOrphanBranchWriter,
      { [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot }
    );
    await localWriter.packDirectoryToBranch(tempDir, GitConstants.KNOWLEDGE_ROOT);

    spinner.succeed(
      `${UI_MESSAGES.SNAPSHOT_SUCCESS} Nodes: ${result.l2Created + result.l3Created}, Links: ${result.linksCreated}`
    );
  } catch (e: any) {
    spinner.fail(UI_MESSAGES.SNAPSHOT_FAIL + e.message);
    process.exit(1);
  } finally {
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
