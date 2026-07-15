import fs from "fs";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type ILogger,
} from "@workspace/contracts";
import {
  ANALYZE_EVENTS,
  ANALYZE_MESSAGES,
  DECISION_EXTRACTION_SYSTEM_PROMPT,
} from "./analyze-messages.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { collectSourceFiles } from "./decision-extraction.js";
import {
  AnalyzeResultKind,
  DecisionNodeType,
  type AnalyzeResult,
  type ExtractedDecision,
} from "./analyze-result.js";

const VALID_NODE_TYPES = Object.values(DecisionNodeType);
const MARKDOWN_CODE_FENCE = "```";

/**
 * Strips a wrapping markdown code fence (```` ```json\n...\n``` ```` or bare ```` ```\n...\n``` ````)
 * from `raw`, tolerating leading/trailing whitespace around the fence. Many OpenAI-compatible LLM
 * backends (e.g. Mistral) wrap valid JSON responses in a markdown fence even when not asked to,
 * which breaks a direct `JSON.parse()`. If `raw` isn't fenced, it is returned unchanged.
 */
export function stripMarkdownCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (
    !trimmed.startsWith(MARKDOWN_CODE_FENCE) ||
    !trimmed.endsWith(MARKDOWN_CODE_FENCE)
  ) {
    return raw;
  }

  const newlineIndex = trimmed.indexOf("\n");
  if (newlineIndex === -1) {
    // A single line of nothing but backticks (and maybe a language tag) — no body to extract.
    return raw;
  }

  const firstLine = trimmed.slice(0, newlineIndex);
  if (!/^```[A-Za-z0-9_-]*$/.test(firstLine)) {
    // Opening "fence" line contains more than just ``` + an optional language tag — not a
    // fence we recognize; leave the content untouched rather than risk mangling it.
    return raw;
  }

  const withoutOpening = trimmed.slice(newlineIndex + 1);
  const withoutClosing = withoutOpening.slice(0, withoutOpening.length - 3);
  return withoutClosing.trim();
}

/**
 * The `analyze` workflow — either a project-wide config scan (old Docuvia's
 * `AnalyzeService.analyzeProject`) or, when `options.targetPath` is set, a focused LLM
 * decision-extraction pass over a specific file/directory (old Docuvia's `ExtractService`,
 * formerly the standalone `extract` command). See `AnalyzeResult`'s discriminated union.
 */
export class AnalyzeWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
    private readonly options?: {
      targetPath?: string;
      llmBaseUrl?: string;
      llmApiKey?: string;
      llmModel?: string;
    },
  ) {}

  public async execute(): Promise<AnalyzeResult> {
    if (this.options?.targetPath) {
      return this.executeDecisionExtraction(this.options.targetPath);
    }
    return this.executeConfigScan();
  }

  private async executeConfigScan(): Promise<AnalyzeResult> {
    const { workspaceRoot, logger } = this;

    logger.info(ANALYZE_MESSAGES.ANALYZING);
    await appendAnalyzeLogLine(workspaceRoot, { event: ANALYZE_EVENTS.START });

    const configScanner = docuviaFactory.resolve(TOKENS.ConfigScanner, {
      logger,
    });
    const { projectType, tags } =
      await configScanner.scanConfigs(workspaceRoot);

    const result: AnalyzeResult = {
      kind: AnalyzeResultKind.CONFIG_SCAN,
      projectType,
      suggestedTags: tags,
    };
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.SUMMARY,
      projectType: result.projectType,
      suggestedTags: result.suggestedTags,
    });
    return result;
  }

  private async executeDecisionExtraction(
    targetPath: string,
  ): Promise<AnalyzeResult> {
    const { workspaceRoot, logger, options } = this;

    logger.info(ANALYZE_MESSAGES.EXTRACTING(targetPath));
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FOCUSED_START,
      targetPath,
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

    if (files.length === 0) {
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_SUMMARY,
        targetPath,
        decisionsCount: 0,
      });
      return {
        kind: AnalyzeResultKind.DECISION_EXTRACTION,
        targetPath,
        decisions: [],
      };
    }

    const userMessage = files
      .map((f) => `--- ${f.relativePath} ---\n${f.content}`)
      .join("\n\n");

    const buildLlmClient = docuviaFactory.resolve(TOKENS.LlmClient);
    const llmClient = buildLlmClient();
    llmClient.initialize({
      baseUrl: options!.llmBaseUrl!,
      apiKey: options!.llmApiKey,
    });

    const response = await llmClient.chatCompletion({
      model: options!.llmModel!,
      temperature: 0.2,
      messages: [
        { role: "system", content: DECISION_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const rawContent = response.choices[0]?.message.content;
    let parsed: unknown;
    if (rawContent === null || rawContent === undefined) {
      const message = ANALYZE_MESSAGES.LLM_NON_JSON_OUTPUT;
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_ERROR,
        targetPath,
        message,
      });
      throw new DocuviaError(ErrorCodes.LLM_INVALID_RESPONSE, message);
    }
    try {
      parsed = JSON.parse(stripMarkdownCodeFence(rawContent));
    } catch {
      const message = ANALYZE_MESSAGES.LLM_NON_JSON_OUTPUT;
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_ERROR,
        targetPath,
        message,
      });
      throw new DocuviaError(ErrorCodes.LLM_INVALID_RESPONSE, message);
    }

    if (!Array.isArray(parsed)) {
      const message = ANALYZE_MESSAGES.LLM_NON_JSON_OUTPUT;
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_ERROR,
        targetPath,
        message,
      });
      throw new DocuviaError(ErrorCodes.LLM_INVALID_RESPONSE, message);
    }

    const decisions: ExtractedDecision[] = parsed.map((item: any) => ({
      title: String(item?.title ?? ""),
      nodeType: (VALID_NODE_TYPES as readonly string[]).includes(item?.nodeType)
        ? (item.nodeType as ExtractedDecision["nodeType"])
        : DecisionNodeType.CONTEXT,
      content: String(item?.content ?? ""),
      confidence: typeof item?.confidence === "number" ? item.confidence : 0,
    }));

    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FOCUSED_SUMMARY,
      targetPath,
      decisionsCount: decisions.length,
    });

    return {
      kind: AnalyzeResultKind.DECISION_EXTRACTION,
      targetPath,
      decisions,
    };
  }
}
