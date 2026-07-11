import path from "path";
import { GraphStore } from "../memory/graph-store.js";
import { WorkspaceGitService } from "../services/workspace-git.service.js";
import { FileDiscoveryService } from "../services/file-discovery.service.js";
import { AstProcessingService } from "../services/ast-processing.service.js";
import { AstWorkerPool } from "../services/ast-worker-pool.js";
import { ConfigScannerService } from "../services/config-scanner.service.js";
import { VcsScannerService } from "../services/vcs-scanner.service.js";
import { InitCommand } from "../services/init/init-command.js";
import { DOCUVIA_DIR_NAME } from "../constants/paths.js";

/** `<workspaceRoot>/.docuvia/local.db` — matches old `InitService.init()`'s path-joining
 *  convention (`path.join(workspaceRoot, ".docuvia", "local.db")`). */
export function resolveDbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, DOCUVIA_DIR_NAME, "local.db");
}

/**
 * The one composition-root function for the `init` capability (per the plan's "Interface / DI
 * discipline" section) — the ONLY place in production code allowed to `new` `WorkspaceGitService`,
 * `FileDiscoveryService`, `AstProcessingService`, `AstWorkerPool`, `ConfigScannerService`, and
 * `VcsScannerService` directly. Both the CLI `init` command and the MCP `docuvia_init` tool
 * (both from a later migration step) call this same function so they can never drift apart.
 *
 * Deviates from the plan's illustrative sketch in one respect: `FileDiscoveryService` and
 * `VcsScannerService`'s actual constructors (built in the prior migration step) each take an
 * `IWorkspaceGitService`, and `AstProcessingService`'s constructor takes an `IASTWorkerPool` —
 * none of the four services in the plan's sketch construct successfully with zero args. A
 * single shared `WorkspaceGitService` instance is constructed once and passed to every step
 * that needs it (mirrors `GraphStore`'s "one connection per process invocation" rationale —
 * no reason to construct three independent git-shell-out wrappers for one `init` run).
 */
export async function buildInitCapability(deps: {
  workspaceRoot: string;
  onProgress?: (msg: string) => void;
}): Promise<InitCommand> {
  const store = await GraphStore.open({ dbPath: resolveDbPath(deps.workspaceRoot) });
  const git = new WorkspaceGitService();

  return new InitCommand({
    store,
    git,
    discovery: new FileDiscoveryService(git),
    astProcessor: new AstProcessingService(new AstWorkerPool()),
    configScanner: new ConfigScannerService(),
    vcsScanner: new VcsScannerService(git),
    workspaceRoot: deps.workspaceRoot,
    onProgress: deps.onProgress,
  });
}
