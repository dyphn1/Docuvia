import fs from "fs/promises";
import path from "path";
import { DOCUVIA_DIR_NAME, DOCUVIA_LOGS_DIR_NAME, INIT_LOG_FILE_NAME } from "../constants/paths.js";

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
  const logPath = path.join(
    workspaceRoot,
    DOCUVIA_DIR_NAME,
    DOCUVIA_LOGS_DIR_NAME,
    INIT_LOG_FILE_NAME
  );
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(
    logPath,
    JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n",
    "utf8"
  );
}

export async function writeInitSummary(
  workspaceRoot: string,
  summary: InitLogSummary
): Promise<void> {
  await appendInitLogLine(workspaceRoot, { event: "init.summary", ...summary });
}
