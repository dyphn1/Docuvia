import fs from "fs";
import path from "path";
import {
  DocuviaError,
  ErrorCodes,
  L3DecisionSources,
  type ILogger,
} from "@workspace/contracts";
import { ANALYZE_EVENTS, ANALYZE_MESSAGES } from "./analyze-messages.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { collectSourceFiles } from "./decision-extraction.js";
import { persistDecisions } from "./persist-l3-decisions.js";
import {
  AnalyzeResultKind,
  type AnalyzeResult,
  type ExtractedDecision,
} from "./analyze-result.js";

/**
 * `analyze <targetPath> --agent-authored`'s write path (issue #42, roadmap items 32-34) --
 * skips the LLM entirely: `deps.decisions` is already the final `ExtractedDecision[]`, produced
 * by the CLI's zod-validated parse of the agent's own stdin/`--decisions-file` payload, not LLM
 * output. Mirrors `AnalyzeWorkflow.executeDecisionExtraction`'s opening/anchor-resolution/persist
 * shape, but skips `userMessage` construction, `llmClient.chatCompletion()`, and
 * `parseDecisionsFromLlmContent()` -- there is no LLM call to make.
 */
export async function runAgentAuthoredWrite(deps: {
  workspaceRoot: string;
  logger: ILogger;
  targetPath: string;
  decisions: ExtractedDecision[];
}): Promise<AnalyzeResult> {
  const { workspaceRoot, logger, targetPath, decisions } = deps;

  logger.info(ANALYZE_MESSAGES.EXTRACTING(targetPath));
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.FOCUSED_START,
    targetPath,
    source: L3DecisionSources.AGENT_AUTHORED,
  });

  const resolvedPath = path.resolve(workspaceRoot, targetPath);
  if (!fs.existsSync(resolvedPath)) {
    const message = ANALYZE_MESSAGES.PATH_NOT_FOUND(targetPath);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FOCUSED_ERROR,
      targetPath,
      message,
    });
    throw new DocuviaError(ErrorCodes.FS_READ_FAILED, message);
  }

  // Mirrors executeDecisionExtraction's empty-files short-circuit (analyze-workflow.ts line
  // 420-433), keyed on the payload's decisions count instead of the collected-files count --
  // there is no LLM call here to produce decisions from files in the first place.
  if (decisions.length === 0) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FOCUSED_SUMMARY,
      targetPath,
      decisionsCount: 0,
    });
    return {
      kind: AnalyzeResultKind.DECISION_EXTRACTION,
      targetPath,
      decisions: [],
      persisted: 0,
      deduped: 0,
    };
  }

  // Only `files[].relativePath` is needed here (to resolve the anchor l2NodeId and build
  // sourceFiles) -- this mode never builds an LLM prompt, so the collected `content` goes
  // unused. Reusing collectSourceFiles as-is means an unused content read happens per file,
  // bounded by the same MAX_ANALYZE_FILES/MAX_ANALYZE_BYTES caps (cheap) -- an accepted,
  // documented tradeoff in exchange for not maintaining a second file-walking implementation.
  const { files, droppedFiles } = collectSourceFiles(
    resolvedPath,
    workspaceRoot,
    logger,
  );
  if (droppedFiles.length > 0) {
    logger.warn(ANALYZE_MESSAGES.FILES_DROPPED(droppedFiles.length), {
      droppedFiles,
      targetPath,
    });
  }

  // Roadmap item 37: a single non-source file can never have an L2 node, so the anchor
  // resolution would fail forever — fail fast with the reason instead of "succeeding" with
  // {persisted: 0, deduped: 0} (the stage path refuses at `--stage` time; this is the direct
  // `--agent-authored` path's symmetric guard).
  if (files.length === 0 && !fs.statSync(resolvedPath).isDirectory()) {
    throw new DocuviaError(
      ErrorCodes.INVALID_INPUT,
      ANALYZE_MESSAGES.AGENT_AUTHORED_ANCHOR_UNRESOLVABLE(targetPath),
    );
  }

  const { persisted, deduped } = await persistDecisions({
    workspaceRoot,
    logger,
    resolvedTargetPath: resolvedPath,
    files,
    decisions,
    source: L3DecisionSources.AGENT_AUTHORED,
    extractionModel: null,
  });

  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.FOCUSED_SUMMARY,
    targetPath,
    decisionsCount: decisions.length,
  });

  return {
    kind: AnalyzeResultKind.DECISION_EXTRACTION,
    targetPath,
    decisions,
    persisted,
    deduped,
  };
}
