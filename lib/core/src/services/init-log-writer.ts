import { INIT_LOG_FILE_NAME } from "../constants/paths.js";
import { appendCommandLogLine } from "./command-log-writer.js";

export interface InitLogSummary {
  filesRequested: number;
  filesParsed: number;
  filesFailed: number;
  failures: { file: string; hash: string; error: string }[];
  /** Count of files skipped during discovery for exceeding MAX_FILE_SIZE_BYTES. Additive
   *  field on top of the original honest-reporting contract. */
  filesSkippedOversized?: number;
}

export async function appendInitLogLine(
  workspaceRoot: string,
  event: Record<string, unknown>
): Promise<void> {
  await appendCommandLogLine(workspaceRoot, INIT_LOG_FILE_NAME, event);
}

export async function writeInitSummary(
  workspaceRoot: string,
  summary: InitLogSummary
): Promise<void> {
  await appendInitLogLine(workspaceRoot, { event: "init.summary", ...summary });
}
