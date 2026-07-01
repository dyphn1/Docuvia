import { Router } from "express";
import { z } from "zod";
import { vscodeQuery, createL3Decision, getFileContext } from "@workspace/core";

const router = Router();

const VscodeQuerySchema = z.object({
  q: z.string().min(1),
  projectId: z.number().optional(),
  limit: z.number().optional().default(10),
});

const VscodeCreateDecisionSchema = z.object({
  projectId: z.number(),
  l2NodeId: z.number().optional(),
  filePath: z.string().optional(),
  agreeToLinkSource: z.boolean().optional(),
  l3Node: z.object({
    title: z.string().min(1),
    content: z.string().optional(),
    nodeType: z.string().optional(),
    commitHash: z.string().optional(),
    aiGenerated: z.boolean().optional(),
    confidence: z.number().optional(),
  }),
});

router.post("/extensions/vscode/query", async (req, res) => {
  const body = VscodeQuerySchema.parse(req.body);
  const result = await vscodeQuery(body.q, body.projectId, body.limit);
  res.json(result);
});

router.post("/extensions/vscode/create-decision", async (req, res) => {
  try {
    const body = VscodeCreateDecisionSchema.parse(req.body);
    const node = await createL3Decision(body as any);
    res.status(201).json(node);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Bad request" });
  }
});

router.get("/extensions/vscode/file-context", async (req, res) => {
  const path = String(req.query.path ?? req.query.file ?? "");
  if (!path) return res.status(400).json({ error: "path query param required" });
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  const ctx = await getFileContext(path, projectId);
  if ((!ctx.l2Nodes || ctx.l2Nodes.length === 0) && (!ctx.l3Nodes || ctx.l3Nodes.length === 0)) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json(ctx);
  return;
});

export default router;
