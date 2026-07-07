import { Router } from "express";
import { DirtyStateManager } from "@workspace/headless-lsp";
import { UpdateVfsBody } from "@workspace/api-zod";

// We will assume there's a simple SSE event emitter or similar.
// For now, let's just create the route.

const router = Router();
const managers = new Map<string, DirtyStateManager>();

function getManager(workspaceRoot: string) {
  let manager = managers.get(workspaceRoot);
  if (!manager) {
    manager = new DirtyStateManager(workspaceRoot);
    manager.initialize().catch(console.error);
    managers.set(workspaceRoot, manager);
  }
  return manager;
}

router.post("/update", async (req, res) => {
  try {
    const body = UpdateVfsBody.parse(req.body);
    const manager = getManager(body.workspaceRoot);
    await manager.markDirty(body.uri, body.content);

    // Return dirty files to the client so it can render the UI overlay
    res.json({ success: true, dirtyFiles: manager.getDirtyFiles() });
  } catch (error) {
    res.status(400).json({ success: false, error: String(error) });
  }
});

export default router;
