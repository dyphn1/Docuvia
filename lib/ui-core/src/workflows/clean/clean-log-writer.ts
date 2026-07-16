import { CLEAN_LOG_FILE_NAME } from "@workspace/contracts";
import { appendCommandLogLine } from "../../utils/command-log-writer.js";
import { CLEAN_EVENTS } from "./clean-messages.js";

export async function appendCleanLogLine(
  workspaceRoot: string,
  event: Record<string, unknown>,
): Promise<void> {
  await appendCommandLogLine(workspaceRoot, CLEAN_LOG_FILE_NAME, event);
}

export async function writeCleanSummary(
  workspaceRoot: string,
  summary: { deleted: boolean; message: string },
): Promise<void> {
  await appendCleanLogLine(workspaceRoot, {
    event: CLEAN_EVENTS.SUMMARY,
    ...summary,
  });
}
