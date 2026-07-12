import {
  docuviaFactory,
  TOKENS,
  DOCUVIA_DIR_NAME,
  LOCAL_DB_FILE_NAME,
  DocuviaError,
  type ILogger,
  type DiagnosticResult,
  DiagnosticStatus,
} from "@workspace/contracts";
import type { DoctorResult } from "./doctor-result.js";
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
          diagnostics["db_runner"] = {
            status: DiagnosticStatus.FAIL,
            message: "DiagnosticRunnerDb not registered",
          };
          allPassed = false;
        }
      } else {
        diagnostics["db_found"] = {
          status: DiagnosticStatus.FAIL,
          message: `Local database not found at ${dbPath}`,
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
            if (error.code === "GIT_NETWORK_TIMEOUT") {
              suggestion =
                "The Git remote operation timed out (5000ms). Check your internet connection or DNS settings.";
            } else if (
              error.code === "GIT_COMMAND_FAILED" &&
              message.includes("does not appear to be a git repository")
            ) {
              suggestion =
                "Ensure this workspace is a valid Git repository and the remote 'origin' is set correctly.";
            } else if (
              error.code === "GIT_COMMAND_FAILED" &&
              message.includes("Could not read from remote repository")
            ) {
              suggestion =
                "Check your SSH keys, PAT, or Git credentials for the remote repository.";
            }
          }

          diagnostics["git_reachability"] = {
            status: DiagnosticStatus.FAIL,
            message: `Git remote reachability check failed: ${message}`,
            suggestion,
          };
        }
      } else {
        diagnostics["git_runner"] = {
          status: DiagnosticStatus.FAIL,
          message: "DiagnosticRunnerGit not registered",
        };
        allPassed = false;
      }
    }

    if (!skipLogs) {
      const logPath = path.join(this.workspaceRoot, DOCUVIA_DIR_NAME, "logs");
      let errorsFound = 0;
      let logsChecked = 0;
      try {
        const logs = await fs.readdir(logPath);
        for (const log of logs) {
          if (!log.endsWith(".log")) continue;
          logsChecked++;
          const content = await fs.readFile(path.join(logPath, log), "utf-8");
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
          diagnostics["logs"] = {
            status: DiagnosticStatus.FAIL,
            message: `Found ${errorsFound} critical errors in logs.`,
            suggestion: "Check the files in .docuvia/logs/ for details.",
          };
          allPassed = false;
        } else {
          diagnostics["logs"] = {
            status: DiagnosticStatus.PASS,
            message: `Checked ${logsChecked} log files, no critical errors found.`,
          };
        }
      } catch {
        diagnostics["logs"] = {
          status: DiagnosticStatus.PASS,
          message: `No logs found at ${logPath}`,
        };
      }
    }

    return { allPassed, diagnostics };
  }
}
