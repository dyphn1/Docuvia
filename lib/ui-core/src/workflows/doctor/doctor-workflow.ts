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

    const dbPassed = skipDb ? true : await this.runDbDiagnostics(diagnostics);
    const gitPassed = skipGit
      ? true
      : await this.runGitDiagnostics(diagnostics);
    const logsPassed = skipLogs
      ? true
      : await this.runLogsDiagnostics(diagnostics);

    return {
      allPassed: dbPassed && gitPassed && logsPassed,
      diagnostics,
    };
  }

  /** `!skipDb` branch of `execute` — checks the local db exists and (if so) delegates to the
   *  registered `DiagnosticRunnerDb`. Returns whether every db diagnostic passed. */
  private async runDbDiagnostics(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    const dbPath = path.join(
      this.workspaceRoot,
      DOCUVIA_DIR_NAME,
      LOCAL_DB_FILE_NAME,
    );
    const hasDb = await fs.stat(dbPath).catch(() => null);

    if (!hasDb) {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.DB_FOUND] = {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.DB_NOT_FOUND_AT(dbPath),
      };
      return false;
    }

    if (!docuviaFactory.has(TOKENS.DiagnosticRunnerDb)) {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.DB_RUNNER] = {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.DB_RUNNER_NOT_REGISTERED,
      };
      return false;
    }

    const dbRunner = docuviaFactory.resolve(TOKENS.DiagnosticRunnerDb);
    const dbResults = await dbRunner.checkHealth(dbPath);
    return this.mergeDiagnosticResults(diagnostics, dbResults);
  }

  /** `!skipGit` branch of `execute` — delegates to the registered `DiagnosticRunnerGit`,
   *  translating a thrown error into a single FAIL diagnostic. Returns whether every git
   *  diagnostic passed. */
  private async runGitDiagnostics(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.DiagnosticRunnerGit)) {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.GIT_RUNNER] = {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.GIT_RUNNER_NOT_REGISTERED,
      };
      return false;
    }

    try {
      const gitRunner = docuviaFactory.resolve(TOKENS.DiagnosticRunnerGit, {
        logger: this.logger,
      });
      const gitResults = await gitRunner.checkHealth(this.workspaceRoot);
      return this.mergeDiagnosticResults(diagnostics, gitResults);
    } catch (error: unknown) {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.GIT_REACHABILITY] =
        this.buildGitReachabilityFailure(error);
      return false;
    }
  }

  /** Merges runner results into `diagnostics` and reports whether all of them passed — shared
   *  by `runDbDiagnostics` and `runGitDiagnostics`. */
  private mergeDiagnosticResults(
    diagnostics: Record<string, DiagnosticResult>,
    results: Record<string, DiagnosticResult>,
  ): boolean {
    let passed = true;
    for (const [key, res] of Object.entries(results)) {
      diagnostics[key] = res;
      if (res.status === DiagnosticStatus.FAIL) passed = false;
    }
    return passed;
  }

  /** Builds the FAIL `DiagnosticResult` for a `DiagnosticRunnerGit.checkHealth` rejection,
   *  attaching a targeted suggestion for known `DocuviaError` codes/messages. */
  private buildGitReachabilityFailure(error: unknown): DiagnosticResult {
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

    return {
      status: DiagnosticStatus.FAIL,
      message: DOCTOR_MESSAGES.GIT_REACHABILITY_FAILED(message),
      suggestion,
    };
  }

  /** `!skipLogs` branch of `execute` — scans `.docuvia/logs/*.log` for error-level entries.
   *  A missing log directory is treated as PASS (nothing to check), matching prior behavior. */
  private async runLogsDiagnostics(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    const logPath = path.join(
      this.workspaceRoot,
      DOCUVIA_DIR_NAME,
      DOCUVIA_LOGS_DIR_NAME,
    );

    try {
      const { errorsFound, logsChecked } = await this.scanLogFiles(logPath);
      if (errorsFound > 0) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LOGS] = {
          status: DiagnosticStatus.FAIL,
          message: DOCTOR_MESSAGES.LOGS_ERRORS_FOUND(errorsFound),
          suggestion: DOCTOR_MESSAGES.LOGS_ERRORS_FOUND_SUGGESTION,
        };
        return false;
      }
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LOGS] = {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.LOGS_CHECKED_CLEAN(logsChecked),
      };
      return true;
    } catch {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LOGS] = {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.LOGS_NOT_FOUND_AT(logPath),
      };
      return true;
    }
  }

  /** Reads every `LOG_FILE_EXTENSION` file under `logPath` and counts newline-delimited JSON
   *  entries with `level >= 50`, ignoring malformed lines — the counting core of
   *  `runLogsDiagnostics`. */
  private async scanLogFiles(
    logPath: string,
  ): Promise<{ errorsFound: number; logsChecked: number }> {
    let errorsFound = 0;
    let logsChecked = 0;
    const logs = await fs.readdir(logPath);
    for (const log of logs) {
      if (!log.endsWith(LOG_FILE_EXTENSION)) continue;
      logsChecked++;
      const content = await fs.readFile(path.join(logPath, log), UTF8_ENCODING);
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
    return { errorsFound, logsChecked };
  }
}
