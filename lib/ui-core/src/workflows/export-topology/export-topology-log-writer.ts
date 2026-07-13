import { EXPORT_TOPOLOGY_LOG_FILE_NAME } from "@workspace/contracts";
import { appendCommandLogLine } from "../../utils/command-log-writer.js";

export async function appendExportTopologyLogLine(
  workspaceRoot: string,
  event: Record<string, unknown>,
): Promise<void> {
  await appendCommandLogLine(
    workspaceRoot,
    EXPORT_TOPOLOGY_LOG_FILE_NAME,
    event,
  );
}
