import { LogLevels } from "@workspace/contracts";
import type { Logger } from "@workspace/contracts";
import { ui } from "../ui/wizard.js";

/**
 * Wires a command's informational log stream into an optional spinner's status line. `spinner`
 * may be `undefined` (structured `--format=json`/`--format=prompt` runs that must keep stdout
 * machine-readable) -- in that case the logs are simply not surfaced to the terminal. Extracted
 * from each command so its `logger.onLog` callback doesn't count toward the command's cyclomatic
 * complexity budget.
 */
export function wireSpinnerLogs(
  logger: Logger,
  spinner: ReturnType<typeof ui.spinner> | undefined,
): void {
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO && spinner) spinner.text = event.message;
  });
}
