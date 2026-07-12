import {
  DiagnosticStatus,
  type DiagnosticResult,
  type IDiagnosticRunner,
} from "@workspace/contracts";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export class GitDiagnosticRunner implements IDiagnosticRunner {
  async checkHealth(cwd: string): Promise<Record<string, DiagnosticResult>> {
    const results: Record<string, DiagnosticResult> = {};

    try {
      // 5-second timeout on network reachability
      const { stdout } = await execAsync("git ls-remote --heads origin", {
        cwd,
        timeout: 5000,
      });
      results["git_network"] = {
        status: DiagnosticStatus.PASS,
        message: "Git remote is reachable",
      };
    } catch (err: any) {
      const code = err.killed
        ? ErrorCodes.GIT_NETWORK_TIMEOUT
        : ErrorCodes.GIT_COMMAND_FAILED;
      throw DocuviaError.wrap(
        code,
        "Git remote reachability check failed",
        err,
      );
    }

    return results;
  }
}
