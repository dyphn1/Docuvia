import {
  LocalOrphanBranchWriter,
  FileDiscoveryService,
  AstProcessingService,
  mapAstToEvents,
  GitNativePersistenceService,
} from "@workspace/core";
import process from "process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ui } from "../ui/wizard.js";

export async function snapshotCommand() {
  const spinner = ui.spinner("Starting local AST snapshot...").start();
  let tempDir = "";
  try {
    const workspaceRoot = process.cwd();

    spinner.text = "Discovering source files...";
    const fileDiscovery = new FileDiscoveryService();
    // Pass an empty dbPath string to skip SQLite hash checking
    const { filesToParse } = await fileDiscovery.discoverFiles(workspaceRoot, "", {
      onlyIndexed: true,
    });

    spinner.text = `Parsing ${filesToParse.length} files...`;
    const astProcessor = new AstProcessingService();
    const parsedResults = await astProcessor.processFiles(workspaceRoot, filesToParse);

    spinner.text = "Mapping AST events...";
    const events = mapAstToEvents(parsedResults);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docuvia-sync-"));

    spinner.text = "Persisting git-native structure...";
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

    spinner.text = "Packing directory to docuvia-knowledge branch...";
    const localWriter = new LocalOrphanBranchWriter(workspaceRoot);
    await localWriter.packDirectoryToBranch(tempDir, "docuvia-knowledge");

    spinner.succeed(
      `Successfully packed local knowledge to branch. Nodes: ${result.l2Created + result.l3Created}, Links: ${result.linksCreated}`
    );
  } catch (e: any) {
    spinner.fail(`Local snapshot (packing) failed: ${e.message}`);
    process.exit(1);
  } finally {
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
