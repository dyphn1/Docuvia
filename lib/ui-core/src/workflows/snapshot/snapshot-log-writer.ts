import { SNAPSHOT_LOG_FILE_NAME } from "@workspace/contracts";
import { appendCommandLogLine } from "../../utils/command-log-writer.js";

export async function appendSnapshotLogLine(
  workspaceRoot: string,
  event: Record<string, unknown>,
): Promise<void> {
  await appendCommandLogLine(workspaceRoot, SNAPSHOT_LOG_FILE_NAME, event);
}
