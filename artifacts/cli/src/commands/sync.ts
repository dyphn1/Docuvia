import process from "process";
import crypto from "node:crypto";
import { createInterface } from "readline";
import {
  docuviaMemory,
  DocuviaError,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { OUTPUT_FORMAT_MARKERS } from "../constants/cli-output-markers.js";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    let data = "";
    rl.on("line", (line) => {
      data += line + "\n";
    });
    rl.on("close", () => resolve(data.trim()));
  });
}

async function resolveProjectId(
  projectId: string | undefined,
  isInteractive: boolean,
): Promise<string> {
  if (projectId) return projectId;

  // Prompt is opt-in (IFCE-004) -- only when --interactive/-i was passed.
  if (!isInteractive) {
    ui.error(UI_MESSAGES.SYNC_MISSING_PROJECT_ID);
    process.exit(1);
  }

  ui.info(UI_MESSAGES.SYNC_NO_PROJECT_ID_PROVIDED);
  const entered = await ui.askInput(UI_MESSAGES.SYNC_PROMPT_PROJECT_ID);

  if (!entered) {
    ui.error(UI_MESSAGES.SYNC_PROJECT_ID_REQUIRED);
    process.exit(1);
  }

  return entered;
}

/**
 * Thin caller of `docuviaApi.sync()` — mirrors `init.ts`'s Presentation-layer responsibilities.
 * `DOCUVIA_API_URL`/`MCP_PAT` are read from `process.env` here (only the Presentation layer may
 * touch `process.env` — see docs/gitbook/architecture/application-lifecycle-and-state.md) and
 * injected into `docuviaMemory` for the Orchestration layer to read.
 */
export async function syncCommand(
  options: { projectId?: string; commitSha?: string },
  cwd: string = process.cwd(),
  isInteractive: boolean = false,
) {
  const projectId = await resolveProjectId(options.projectId, isInteractive);

  if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
    ui.warn(UI_MESSAGES.SYNC_MISSING_ENV);
    ui.warn(UI_MESSAGES.SYNC_SKIP);
    return;
  }

  // NOTE: deliberately still keyed on `process.stdin.isTTY` (not `isInteractive`) -- this isn't
  // a prompt-safety gate, it's "is there piped data (a commit sha) sitting on stdin to consume"
  // (the pre-push hook pipes one in). Swapping it for the opt-in `isInteractive` flag would make
  // a human at a real terminal, who never passes --interactive, hang here waiting on stdin to
  // close instead of skipping the read.
  const commitSha =
    options.commitSha ?? (process.stdin.isTTY ? undefined : await readStdin());

  const spinner = ui
    .spinner(
      UI_MESSAGES.SYNC_START + projectId + OUTPUT_FORMAT_MARKERS.ELLIPSIS,
    )
    .start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  docuviaMemory.set(scopeId, MemoryKeys.API_URL, process.env.DOCUVIA_API_URL);
  docuviaMemory.set(scopeId, MemoryKeys.PAT, process.env.MCP_PAT);
  docuviaMemory.set(scopeId, MemoryKeys.PROJECT_ID, projectId);
  docuviaMemory.set(scopeId, MemoryKeys.COMMIT_SHA, commitSha || undefined);

  try {
    const result = await docuviaApi.sync(scopeId, logger);
    spinner.succeed(UI_MESSAGES.SYNC_SUCCESS + " " + result.message);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.SYNC_FAIL + message);
    // process.exitCode (not process.exit()) — this path follows real network calls (GET
    // l2-nodes / POST sync/push); forcing an immediate exit while fetch/undici handles are
    // still closing crashes natively on Windows. See old Docuvia's sync.ts for the same fix.
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
