import {
  DiagnosticStatus,
  type DiagnosticResult,
  type IDiagnosticRunner,
} from "@workspace/contracts";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/** Key this runner reports its single check under in `checkHealth`'s result map. */
const GIT_DIAGNOSTIC_KEY_NETWORK = "git_network" as const;

const GIT_DIAGNOSTIC_MESSAGES = {
  REMOTE_REACHABLE: "Git remote is reachable",
  REMOTE_REACHABILITY_CHECK_FAILED: "Git remote reachability check failed",
} as const;

export class GitDiagnosticRunner implements IDiagnosticRunner {
  async checkHealth(cwd: string): Promise<Record<string, DiagnosticResult>> {
    const results: Record<string, DiagnosticResult> = {};

    try {
      // 5-second timeout on network reachability
      const { stdout } = await execAsync("git ls-remote --heads origin", {
        cwd,
        timeout: 5000,
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
