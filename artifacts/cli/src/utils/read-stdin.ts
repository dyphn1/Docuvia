import process from "process";
import { createInterface } from "readline";

/**
 * Reads all of stdin, line-buffered, resolving with the trimmed accumulated text once stdin
 * closes. Extracted from `publish.ts` (issue #42) -- shared with `analyze.ts`'s
 * `--agent-authored` mode, whose default input is a piped decisions JSON payload.
 */
export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    let data = "";
    rl.on("line", (line) => {
      data += line + "\n";
    });
    rl.on("close", () => resolve(data.trim()));
  });
}
