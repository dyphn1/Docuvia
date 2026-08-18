import process from "process";
import { createInterface } from "readline";

/**
 * Reads all of stdin, line-buffered, resolving with the trimmed accumulated text once stdin
 * closes. Extracted from `publish.ts` (issue #42) -- shared with `analyze.ts`'s
 * `--agent-authored` mode, whose default input is a piped decisions JSON payload.
 */
export async function readStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  try {
    for await (const line of rl) {
      lines.push(line);
    }
  } finally {
    // Issue #72: explicitly release the interface (drops its stream listeners) instead of relying
    // on the implicit close — a long-running process would otherwise leak the fd/listeners on
    // repeated calls. Idempotent: a naturally-completed iteration already closed it.
    rl.close();
  }
  return lines.join("\n").trim();
}
