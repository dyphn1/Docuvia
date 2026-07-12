import process from "process";
import crypto from "node:crypto";
import { docuviaMemory, DocuviaError, type KnowledgeBranchSyncResult } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

const STATUS_MESSAGES: Record<KnowledgeBranchSyncResult["status"], string> = {
  "no-remote": UI_MESSAGES.SYNC_KNOWLEDGE_NO_REMOTE,
  "up-to-date": UI_MESSAGES.SYNC_KNOWLEDGE_UP_TO_DATE,
  "fast-forwarded-local": UI_MESSAGES.SYNC_KNOWLEDGE_FAST_FORWARDED,
  "pushed-local": UI_MESSAGES.SYNC_KNOWLEDGE_PUSHED,
  merged: UI_MESSAGES.SYNC_KNOWLEDGE_MERGED,
};

/** Thin caller of `docuviaApi.syncKnowledge()` — mirrors `hydrate.ts`'s Presentation-layer responsibilities. */
export async function syncKnowledgeCommand(cwd: string = process.cwd()) {
  const spinner = ui.spinner(UI_MESSAGES.SYNC_KNOWLEDGE_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === "info") spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, "workspaceRoot", cwd);

  try {
    const result = await docuviaApi.syncKnowledge(scopeId, logger);
    if (result.status === "no-remote") {
      spinner.warn(STATUS_MESSAGES[result.status]);
      return;
    }
    spinner.succeed(STATUS_MESSAGES[result.status]);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error ? error.message : String(error);
    spinner.fail(UI_MESSAGES.SYNC_KNOWLEDGE_FAIL + message);
    process.exit(1);
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
