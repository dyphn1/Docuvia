import { Router } from "express";
import { l2NodesService } from "../services/l2-nodes.service.js";
import {
  CreateL2NodeBody,
  UpdateL2NodeParams,
  UpdateL2NodeBody,
  DeleteL2NodeParams,
  ConfirmBootstrapBody,
} from "@workspace/api-zod";
import { z } from "zod";

const NodeLinkInputSchema = z.object({
  targetNodeId: z.number(),
  linkType: z.string().optional().default("depends_on"),
});

const router = Router();

router.post("/projects/:id/l2-nodes/confirm-bootstrap", async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const body = ConfirmBootstrapBody.parse(req.body);

    await l2NodesService.confirmBootstrap(projectId, body);

    return res.json({ success: true, message: "Bootstrap confirmed successfully" });
  } catch (error: any) {
    if (error.message === "Project not found") {
      return res.status(404).json({ error: "Project not found" });
    }
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/l2-nodes", async (req, res) => {
  console.log("HITTING L2 NODE POST");
  const body = CreateL2NodeBody.parse(req.body);
  const node = await l2NodesService.createNode(body);
  res.status(201).json({
    ...node,
    createdAt: node.createdAt.toISOString(),
  });
});

router.patch("/l2-nodes/:id", async (req, res) => {
  const { id } = UpdateL2NodeParams.parse({ id: Number(req.params.id) });
  const body = UpdateL2NodeBody.parse(req.body);
  const node = await l2NodesService.updateNode(id, body);
  if (!node) return res.status(404).json({ error: "Not found" });

  return res.json({
    ...node,
    createdAt: node.createdAt.toISOString(),
  });
});

router.delete("/l2-nodes/:id", async (req, res) => {
  const { id } = DeleteL2NodeParams.parse({ id: Number(req.params.id) });
  await l2NodesService.deleteNode(id);
  res.status(204).send();
});

router.get("/l2-nodes/:id/links", async (req, res) => {
  const id = Number(req.params.id);
  const links = await l2NodesService.getLinks(id);
  res.json(
    links.map((link) => ({
      ...link,
      createdAt: link.createdAt.toISOString(),
    }))
  );
});

router.post("/l2-nodes/:id/links", async (req, res) => {
  const sourceNodeId = Number(req.params.id);
  const body = NodeLinkInputSchema.parse(req.body);
  const link = await l2NodesService.createLink(sourceNodeId, body.targetNodeId, body.linkType);
  res.status(201).json({
    ...link,
    createdAt: link.createdAt.toISOString(),
  });
});

export { router as l2NodesRouter };
