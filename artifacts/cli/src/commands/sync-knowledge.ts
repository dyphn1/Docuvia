import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  KnowledgeBranchSyncStatuses,
  type KnowledgeBranchSyncResult,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

const STATUS_MESSAGES: Record<KnowledgeBranchSyncResult["status"], string> = {
  [KnowledgeBranchSyncStatuses.NO_REMOTE]: UI_MESSAGES.SYNC_KNOWLEDGE_NO_REMOTE,
  [KnowledgeBranchSyncStatuses.UP_TO_DATE]:
    UI_MESSAGES.SYNC_KNOWLEDGE_UP_TO_DATE,
  [KnowledgeBranchSyncStatuses.FAST_FORWARDED_LOCAL]:
    UI_MESSAGES.SYNC_KNOWLEDGE_FAST_FORWARDED,
  [KnowledgeBranchSyncStatuses.PUSHED_LOCAL]: UI_MESSAGES.SYNC_KNOWLEDGE_PUSHED,
  [KnowledgeBranchSyncStatuses.MERGED]: UI_MESSAGES.SYNC_KNOWLEDGE_MERGED,
};

/** Thin caller of `docuviaApi.syncKnowledge()` — mirrors `hydrate.ts`'s Presentation-layer responsibilities. */
export async function syncKnowledgeCommand(cwd: string = process.cwd()) {
  const spinner = ui.spinner(UI_MESSAGES.SYNC_KNOWLEDGE_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  const timeoutRaw = process.env.DOCUVIA_PUSH_TIMEOUT_MS;
  if (timeoutRaw) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.GIT_NETWORK_TIMEOUT_MS,
      Number(timeoutRaw),
    );
  }

  try {
    const result = await docuviaApi.syncKnowledge(scopeId, logger);
    if (result.status === KnowledgeBranchSyncStatuses.NO_REMOTE) {
      spinner.warn(STATUS_MESSAGES[result.status]);
      return;
    }
    spinner.succeed(STATUS_MESSAGES[result.status]);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.SYNC_KNOWLEDGE_FAIL + message);
    // process.exitCode (not process.exit()) — process.exit() terminates before the `finally`
    // below runs, silently skipping the memory-scope cleanup.
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
