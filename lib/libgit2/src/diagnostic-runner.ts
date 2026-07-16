import {
  DiagnosticStatus,
  GIT_DEFAULT_REMOTE_NAME,
  type DiagnosticResult,
  type IDiagnosticRunner,
} from "@workspace/contracts";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { exec } from "child_process";
import { promisify } from "util";
import { GIT_BIN } from "./constants/git-cli.js";

const execAsync = promisify(exec);

/** Key this runner reports its single check under in `checkHealth`'s result map. */
const GIT_DIAGNOSTIC_KEY_NETWORK = "git_network" as const;

const GIT_DIAGNOSTIC_MESSAGES = {
  REMOTE_REACHABLE: "Git remote is reachable",
  REMOTE_REACHABILITY_CHECK_FAILED: "Git remote reachability check failed",
} as const;

/** `git ls-remote --heads <remote>` — lists the remote's branch tips without fetching any
 *  objects, making it a cheap reachability probe. */
const GIT_LS_REMOTE_SUBCOMMAND = "ls-remote" as const;
const GIT_LS_REMOTE_HEADS_FLAG = "--heads" as const;

const GIT_NETWORK_CHECK_COMMAND = `${GIT_BIN} ${GIT_LS_REMOTE_SUBCOMMAND} ${GIT_LS_REMOTE_HEADS_FLAG} ${GIT_DEFAULT_REMOTE_NAME}`;

/** 5-second timeout on network reachability. */
const NETWORK_CHECK_TIMEOUT_MS = 5000;

export class GitDiagnosticRunner implements IDiagnosticRunner {
  async checkHealth(cwd: string): Promise<Record<string, DiagnosticResult>> {
    const results: Record<string, DiagnosticResult> = {};

    try {
      const { stdout } = await execAsync(GIT_NETWORK_CHECK_COMMAND, {
        cwd,
        timeout: NETWORK_CHECK_TIMEOUT_MS,
      });
      results[GIT_DIAGNOSTIC_KEY_NETWORK] = {
        status: DiagnosticStatus.PASS,
        message: GIT_DIAGNOSTIC_MESSAGES.REMOTE_REACHABLE,
      };
    } catch (err: any) {
      const code = err.killed
        ? ErrorCodes.GIT_NETWORK_TIMEOUT
        : ErrorCodes.GIT_COMMAND_FAILED;
      throw DocuviaError.wrap(
        code,
        GIT_DIAGNOSTIC_MESSAGES.REMOTE_REACHABILITY_CHECK_FAILED,
        err,
      );
    }

    return results;
  }
}
