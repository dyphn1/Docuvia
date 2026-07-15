import {
  docuviaFactory,
  TOKENS,
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  LOCAL_DB_FILE_NAME,
  DocuviaError,
  ErrorCodes,
  UTF8_ENCODING,
  type ILogger,
  type DiagnosticResult,
  DiagnosticStatus,
} from "@workspace/contracts";
import type { DoctorResult } from "./doctor-result.js";
import {
  DOCTOR_DIAGNOSTIC_KEYS,
  DOCTOR_MESSAGES,
  LOG_FILE_EXTENSION,
} from "./doctor-messages.js";
import * as path from "path";
import * as fs from "fs/promises";

export interface DoctorOptions {
  skipDb?: boolean;
  skipGit?: boolean;
  skipLogs?: boolean;
}

export class DoctorWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  async execute(options: DoctorOptions = {}): Promise<DoctorResult> {
    const { skipDb = false, skipGit = false, skipLogs = false } = options;
    const diagnostics: Record<string, DiagnosticResult> = {};
    let allPassed = true;

    if (!skipDb) {
      const dbPath = path.join(
        this.workspaceRoot,
        DOCUVIA_DIR_NAME,
        LOCAL_DB_FILE_NAME,
      );
      const hasDb = await fs.stat(dbPath).catch(() => null);

      if (hasDb) {
        if (docuviaFactory.has(TOKENS.DiagnosticRunnerDb)) {
          const dbRunner = docuviaFactory.resolve(TOKENS.DiagnosticRunnerDb);
          const dbResults = await dbRunner.checkHealth(dbPath);
          for (const [key, res] of Object.entries(dbResults)) {
            diagnostics[key] = res;
            if (res.status === DiagnosticStatus.FAIL) allPassed = false;
          }
        } else {
          diagnostics[DOCTOR_DIAGNOSTIC_KEYS.DB_RUNNER] = {
            status: DiagnosticStatus.FAIL,
            message: DOCTOR_MESSAGES.DB_RUNNER_NOT_REGISTERED,
          };
          allPassed = false;
        }
      } else {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.DB_FOUND] = {
          status: DiagnosticStatus.FAIL,
          message: DOCTOR_MESSAGES.DB_NOT_FOUND_AT(dbPath),
        };
        allPassed = false;
      }
    }

    if (!skipGit) {
      if (docuviaFactory.has(TOKENS.DiagnosticRunnerGit)) {
        try {
          const gitRunner = docuviaFactory.resolve(TOKENS.DiagnosticRunnerGit, {
            logger: this.logger,
          });
          const gitResults = await gitRunner.checkHealth(this.workspaceRoot);
          for (const [key, res] of Object.entries(gitResults)) {
            diagnostics[key] = res;
            if (res.status === DiagnosticStatus.FAIL) allPassed = false;
          }
        } catch (error: unknown) {
          allPassed = false;
          const message =
            error instanceof DocuviaError || error instanceof Error
              ? error.message
              : String(error);

          let suggestion = undefined;
          if (error instanceof DocuviaError) {
            if (error.code === ErrorCodes.GIT_NETWORK_TIMEOUT) {
              suggestion = DOCTOR_MESSAGES.GIT_NETWORK_TIMEOUT_SUGGESTION;
            } else if (
              error.code === ErrorCodes.GIT_COMMAND_FAILED &&
              message.includes(DOCTOR_MESSAGES.GIT_NOT_A_REPO_TEXT)
            ) {
              suggestion = DOCTOR_MESSAGES.GIT_NOT_A_REPO_SUGGESTION;
            } else if (
              error.code === ErrorCodes.GIT_COMMAND_FAILED &&
              message.includes(DOCTOR_MESSAGES.GIT_REMOTE_UNREADABLE_TEXT)
            ) {
              suggestion = DOCTOR_MESSAGES.GIT_REMOTE_UNREADABLE_SUGGESTION;
            }
          }

          diagnostics[DOCTOR_DIAGNOSTIC_KEYS.GIT_REACHABILITY] = {
            status: DiagnosticStatus.FAIL,
            message: DOCTOR_MESSAGES.GIT_REACHABILITY_FAILED(message),
            suggestion,
          };
        }
      } else {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.GIT_RUNNER] = {
          status: DiagnosticStatus.FAIL,
          message: DOCTOR_MESSAGES.GIT_RUNNER_NOT_REGISTERED,
        };
        allPassed = false;
      }
    }

    if (!skipLogs) {
      const logPath = path.join(
        this.workspaceRoot,
        DOCUVIA_DIR_NAME,
        DOCUVIA_LOGS_DIR_NAME,
      );
      let errorsFound = 0;
      let logsChecked = 0;
      try {
        const logs = await fs.readdir(logPath);
        for (const log of logs) {
          if (!log.endsWith(LOG_FILE_EXTENSION)) continue;
          logsChecked++;
          const content = await fs.readFile(
            path.join(logPath, log),
            UTF8_ENCODING,
          );
          const lines = content.split("\n").filter((l) => l.trim().length > 0);
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.level && entry.level >= 50) {
                errorsFound++;
              }
            } catch {
              // Ignore malformed JSON
            }
          }
        }
        if (errorsFound > 0) {
          diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LOGS] = {
            status: DiagnosticStatus.FAIL,
            message: DOCTOR_MESSAGES.LOGS_ERRORS_FOUND(errorsFound),
            suggestion: DOCTOR_MESSAGES.LOGS_ERRORS_FOUND_SUGGESTION,
          };
          allPassed = false;
        } else {
          diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LOGS] = {
            status: DiagnosticStatus.PASS,
            message: DOCTOR_MESSAGES.LOGS_CHECKED_CLEAN(logsChecked),
          };
        }
      } catch {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LOGS] = {
          status: DiagnosticStatus.PASS,
          message: DOCTOR_MESSAGES.LOGS_NOT_FOUND_AT(logPath),
        };
      }
    }

    return { allPassed, diagnostics };
  }
}
