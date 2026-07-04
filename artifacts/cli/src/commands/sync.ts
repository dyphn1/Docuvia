import {
  SyncService,
  LocalOrphanBranchWriter,
  FileDiscoveryService,
  AstProcessingService,
  mapAstToEvents,
  GitNativePersistenceService,
} from "@workspace/core";
import { createInterface } from "readline";
import process from "process";
import fs from "fs/promises";
import path from "path";
import os from "os";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    let data = "";
    rl.on("line", (line) => {
      data += line + "\n";
    });
    rl.on("close", () => resolve(data.trim()));
  });
}

export async function syncCommand(options: {
  isLocal: boolean;
  projectId?: string;
  commitSha?: string;
}) {
  if (options.isLocal) {
    console.log("[docuvia] Running local AST sync...");
    // NOTE: this path re-parses the AST into a discarded temp dir and writes straight to the
    // git orphan branch — it is a separate pipeline from `analyze`'s .docuvia/local.db
    // (SqliteGraphRepository); the two never intersect. See
    // docs/gitbook/evaluate/local-sqlite-write-pipeline.md "Current State" for details.
    let tempDir = "";
    try {
      const workspaceRoot = process.cwd();

      const fileDiscovery = new FileDiscoveryService();
      // Pass an empty dbPath string to skip SQLite hash checking
      const { filesToParse } = await fileDiscovery.discoverFiles(workspaceRoot, "", {
        onlyIndexed: true,
      });

      const astProcessor = new AstProcessingService();
      const parsedResults = await astProcessor.processFiles(workspaceRoot, filesToParse);

      const events = mapAstToEvents(parsedResults);

      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docuvia-sync-"));

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

      // Unify local CLI sync with the shared pipeline (Database-as-IPC)
      const { writeKnowledgeToOrphanBranch } = await import("@workspace/core");
      // Since local CLI doesn't have a projectId for pure local sync in the old flow,
      // we assume projectId 1 or similar for local-only DB syncs, but actually, the DB write
      // already happened. We just need to trigger the actual writeKnowledgeToOrphanBranch.
      // We will pass projectId = 1 as local fallback.
      await writeKnowledgeToOrphanBranch(1);

      console.log(
        `[docuvia] Successfully packed local knowledge to branch. Nodes: ${result.l2Created + result.l3Created}, Links: ${result.linksCreated}`
      );
    } catch (e: any) {
      console.error("Local sync (packing) failed:", e.message);
      process.exit(1);
    } finally {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {}
      }
    }
    return;
  }

  const projectId = options.projectId;
  if (!projectId) {
    console.error("Usage: docuvia sync <project_id> [commit_sha]");
    process.exit(1);
  }

  if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
    console.warn("⚠️  DOCUVIA_API_URL or MCP_PAT is missing in the environment.");
    console.warn(
      "   Skipping background sync. Please set these variables in your .env file or environment to enable syncing."
    );
    return;
  }

  const commitSha = options.commitSha ?? (process.stdin.isTTY ? undefined : await readStdin());

  const syncService = new SyncService(
    process.cwd(),
    process.env.DOCUVIA_API_URL,
    process.env.MCP_PAT,
    (msg: string) => console.log(msg)
  );

  try {
    await syncService.sync(projectId, commitSha);
  } catch (e: any) {
    console.error("Sync failed:", e);
    process.exit(1);
  }
}
