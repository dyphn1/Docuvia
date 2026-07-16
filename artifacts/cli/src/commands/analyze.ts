import process from "process";
import crypto from "node:crypto";
import { docuviaMemory, DocuviaError } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

/**
 * Thin caller of `docuviaApi.analyze()` — both branches:
 * - No `targetPath`: project-wide config scan (mirrors old Docuvia's `runFullAnalysis`).
 * - `targetPath` given: focused LLM decision extraction (mirrors old Docuvia's
 *   `runFocusedExtraction`/the old `extract` command). Requires
 *   `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` and a model
 *   (`AI_DOCUVIA_MODEL`/`AI_DOCUVIA_FAST_MODEL`) to be set; missing env vars are a hard failure
 *   (exit 1) rather than a silent skip — unlike `sync.ts`'s missing-env behavior — because a
 *   user who explicitly asked to analyze a path expects LLM extraction to actually run.
 */
export async function analyzeCommand(
  targetPath?: string,
  cwd: string = process.cwd(),
) {
  let llmBaseUrl: string | undefined;
  let llmApiKey: string | undefined;
  let llmModel: string | undefined;

  if (targetPath) {
    llmBaseUrl = process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL;
    llmApiKey = process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY;
    llmModel =
      process.env.AI_DOCUVIA_MODEL || process.env.AI_DOCUVIA_FAST_MODEL;

    if (!llmBaseUrl || !llmModel) {
      ui.error(UI_MESSAGES.ANALYZE_LLM_MISSING_ENV);
      process.exitCode = 1;
      return;
    }
  }

  ui.header(
    targetPath
      ? UI_MESSAGES.ANALYZE_FOCUSED_HEADER
      : UI_MESSAGES.ANALYZE_HEADER,
  );
  const spinner = ui
    .spinner(
      targetPath
        ? UI_MESSAGES.ANALYZE_FOCUSED_START + targetPath + "..."
        : UI_MESSAGES.ANALYZE_START,
    )
    .start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === "info") spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, "workspaceRoot", cwd);
  if (targetPath) {
    docuviaMemory.set(scopeId, "targetPath", targetPath);
    docuviaMemory.set(scopeId, "llmBaseUrl", llmBaseUrl);
    docuviaMemory.set(scopeId, "llmApiKey", llmApiKey);
    docuviaMemory.set(scopeId, "llmModel", llmModel);
  }

  try {
    const result = await docuviaApi.analyze(scopeId, logger);

    if (result.kind === "configScan") {
      spinner.succeed(UI_MESSAGES.ANALYZE_SUCCESS);
      ui.info(UI_MESSAGES.ANALYZE_PROJECT_TYPE + result.projectType);
      ui.info(
        UI_MESSAGES.ANALYZE_SUGGESTED_TAGS +
          (result.suggestedTags.join(", ") || UI_MESSAGES.ANALYZE_NONE),
      );
    } else {
      spinner.succeed(UI_MESSAGES.ANALYZE_FOCUSED_SUCCESS);
      if (result.decisions.length === 0) {
        ui.info(UI_MESSAGES.ANALYZE_FOCUSED_NONE);
      } else {
        for (const decision of result.decisions) {
          ui.info(
            `[${decision.nodeType}] ${decision.title} (confidence: ${decision.confidence})`,
          );
          if (decision.content) {
            console.log(`    ${decision.content}`);
          }
        }
        ui.info(
          UI_MESSAGES.ANALYZE_FOCUSED_PERSISTED(
            result.persisted,
            result.deduped,
          ),
        );
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(
      (targetPath
        ? UI_MESSAGES.ANALYZE_FOCUSED_FAIL
        : UI_MESSAGES.ANALYZE_FAIL) + message,
    );
    // process.exitCode (not process.exit()) for both branches — the targetPath branch follows
    // a real network call (LLM chat completion); forcing an immediate exit while fetch/undici
    // handles are still closing crashes natively on Windows. See sync.ts's identical fix.
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
