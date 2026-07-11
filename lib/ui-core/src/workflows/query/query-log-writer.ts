import { QUERY_LOG_FILE_NAME } from "@workspace/contracts";
import { appendCommandLogLine } from "../../utils/command-log-writer.js";

export async function appendQueryLogLine(
  workspaceRoot: string,
  event: Record<string, unknown>
): Promise<void> {
  await appendCommandLogLine(workspaceRoot, QUERY_LOG_FILE_NAME, event);
}
