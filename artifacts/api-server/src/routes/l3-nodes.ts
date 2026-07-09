import { API_MESSAGES } from "@workspace/core";
import { Router } from "express";
import { l3NodesService } from "../services/l3-nodes.service.js";
import {
  ListL3NodesParams,
  CreateL3NodeParams,
  CreateL3NodeBody,
  UpdateL3NodeParams,
  UpdateL3NodeBody,
  DeleteL3NodeParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/l2-nodes/:id/l3-nodes", async (req, res) => {
  const { id } = ListL3NodesParams.parse({ id: Number(req.params.id) });
  const nodes = await l3NodesService.getNodesByL2Id(id);
  res.json(nodes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })));
});

router.post("/l2-nodes/:id/l3-nodes", async (req, res) => {
  const { id } = CreateL3NodeParams.parse({ id: Number(req.params.id) });
  const body = CreateL3NodeBody.parse(req.body);
  const node = await l3NodesService.createNode(id, body);
  res.status(201).json({ ...node, createdAt: node.createdAt.toISOString() });
});

router.patch("/l3-nodes/:id", async (req, res) => {
  const { id } = UpdateL3NodeParams.parse({ id: Number(req.params.id) });
  const body = UpdateL3NodeBody.parse(req.body);
  const node = await l3NodesService.updateNode(id, body);
  if (!node) return res.status(404).json({ error: API_MESSAGES.NOT_FOUND });
  return res.json({ ...node, createdAt: node.createdAt.toISOString() });
});

router.delete("/l3-nodes/:id", async (req, res) => {
  const { id } = DeleteL3NodeParams.parse({ id: Number(req.params.id) });
  await l3NodesService.deleteNode(id);
  res.status(204).send();
});

export { router as l3NodesRouter };
