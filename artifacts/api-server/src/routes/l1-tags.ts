import { API_MESSAGES } from "@workspace/core";
import { Router } from "express";
import { l1TagsService } from "../services/l1-tags.service.js";
import {
  CreateL1TagBody,
  UpdateL1TagParams,
  UpdateL1TagBody,
  DeleteL1TagParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/l1-tags", async (req, res) => {
  const tags = await l1TagsService.getAllTags();
  res.json(tags.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })));
});

router.post("/l1-tags", async (req, res) => {
  const body = CreateL1TagBody.parse(req.body);
  const tag = await l1TagsService.createTag(body);
  res.status(201).json({ ...tag, createdAt: tag.createdAt.toISOString() });
});

router.patch("/l1-tags/:id", async (req, res) => {
  const { id } = UpdateL1TagParams.parse({ id: Number(req.params.id) });
  const body = UpdateL1TagBody.parse(req.body);
  const tag = await l1TagsService.updateTag(id, body);
  if (!tag) return res.status(404).json({ error: API_MESSAGES.NOT_FOUND });
  return res.json({ ...tag, createdAt: tag.createdAt.toISOString() });
});

router.delete("/l1-tags/:id", async (req, res) => {
  const { id } = DeleteL1TagParams.parse({ id: Number(req.params.id) });
  await l1TagsService.deleteTag(id);
  res.status(204).send();
});

export { router as l1TagsRouter };
