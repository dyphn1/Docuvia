import { SYNC_KNOWLEDGE_LOG_FILE_NAME } from "@workspace/contracts";
import { appendCommandLogLine } from "../../utils/command-log-writer.js";

export async function appendSyncKnowledgeLogLine(
  workspaceRoot: string,
  event: Record<string, unknown>
): Promise<void> {
  await appendCommandLogLine(workspaceRoot, SYNC_KNOWLEDGE_LOG_FILE_NAME, event);
}
