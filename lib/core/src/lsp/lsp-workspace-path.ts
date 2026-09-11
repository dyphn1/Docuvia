import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { resolveWithinRoot } from "../utils/safe-fs.js";

const LSP_WORKSPACE_PATH_TRAVERSAL_MESSAGE =
  "LSP file path resolves outside the configured workspace root";

/**
 * Resolves a relative file path for LSP ingestion while enforcing workspace containment.
 * Keeping this boundary next to the LSP transport makes it impossible for a stale/hostile file
 * list entry to turn `textDocument/didOpen` into an arbitrary local-file read.
 */
export function resolveLspWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
): string {
  const resolved = resolveWithinRoot(workspaceRoot, relativePath);
  if (!resolved) {
    throw new DocuviaError(
      ErrorCodes.FS_PATH_TRAVERSAL,
      LSP_WORKSPACE_PATH_TRAVERSAL_MESSAGE,
    );
  }
  return resolved;
}
