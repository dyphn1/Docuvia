import { INIT_LOG_FILE_NAME } from "@workspace/contracts";
import { appendCommandLogLine } from "../../utils/command-log-writer.js";

export interface InitLogSummary {
  filesRequested: number;
  filesParsed: number;
  filesFailed: number;
  failures: { file: string; hash: string; error: string }[];
  filesSkippedOversized?: number;
}

export async function appendInitLogLine(
  workspaceRoot: string,
  event: Record<string, unknown>,
): Promise<void> {
  await appendCommandLogLine(workspaceRoot, INIT_LOG_FILE_NAME, event);
}

export async function writeInitSummary(
  workspaceRoot: string,
  summary: InitLogSummary,
): Promise<void> {
  await appendInitLogLine(workspaceRoot, { event: "init.summary", ...summary });
}
