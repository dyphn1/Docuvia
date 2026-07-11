import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
import { DEFAULT_PROMPTS } from "../utils/prompts.js";
import { resolveLocalLlmOrchestrator } from "./local-llm-provider.js";
import { isSupportedSourceFile } from "../utils/language-detection.js";
import { appendCommandLogLine } from "./command-log-writer.js";
import { ANALYZE_LOG_FILE_NAME } from "../constants/paths.js";

/** Files at/above this count are dropped from analysis rather than silently included. */
export const MAX_ANALYZE_FILES = 40;
/** Cumulative content bytes at/above this size are dropped from analysis. */
export const MAX_ANALYZE_BYTES = 200_000;

export interface ExtractedDecision {
  title: string;
  nodeType: string;
  content: string;
  confidence: number;
}

export interface ExtractDecisionsResult {
  decisions: ExtractedDecision[];
}

interface CollectedFile {
  relativePath: string;
  content: string;
}

export class ExtractService {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async extractDecisions(targetPath: string): Promise<ExtractDecisionsResult> {
    logger.info({ targetPath }, "Extracting decisions");
    await appendCommandLogLine(this.workspaceRoot, ANALYZE_LOG_FILE_NAME, {
      event: "analyze.focused.start",
      targetPath,
    }).catch(() => {});

    const resolvedPath = path.resolve(this.workspaceRoot, targetPath);
    if (!fs.existsSync(resolvedPath)) {
      const message = `Path does not exist: ${targetPath}`;
      await appendCommandLogLine(this.workspaceRoot, ANALYZE_LOG_FILE_NAME, {
        event: "analyze.focused.error",
        targetPath,
        message,
      }).catch(() => {});
      throw new Error(message);
    }

    const { files, droppedFiles } = this.collectSourceFiles(resolvedPath);
    if (droppedFiles.length > 0) {
      logger.warn(
        { droppedFiles, targetPath },
        `Dropped ${droppedFiles.length} file(s) from decision extraction (file-count/byte cap)`
      );
    }

    if (files.length === 0) {
      await appendCommandLogLine(this.workspaceRoot, ANALYZE_LOG_FILE_NAME, {
        event: "analyze.focused.summary",
        targetPath,
        decisionsCount: 0,
      }).catch(() => {});
      return { decisions: [] };
    }

    const userMessage = files.map((f) => `--- ${f.relativePath} ---\n${f.content}`).join("\n\n");

    const { orchestrator, model } = resolveLocalLlmOrchestrator();

    const response = await orchestrator.generate({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: DEFAULT_PROMPTS.path_decision_extractor },
        { role: "user", content: userMessage },
      ],
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      const message = "LLM returned non-JSON output for decision extraction";
      await appendCommandLogLine(this.workspaceRoot, ANALYZE_LOG_FILE_NAME, {
        event: "analyze.focused.error",
        targetPath,
        message,
      }).catch(() => {});
      throw new Error(message);
    }

    if (!Array.isArray(parsed)) {
      const message = "LLM returned non-JSON output for decision extraction";
      await appendCommandLogLine(this.workspaceRoot, ANALYZE_LOG_FILE_NAME, {
        event: "analyze.focused.error",
        targetPath,
        message,
      }).catch(() => {});
      throw new Error(message);
    }

    const decisions: ExtractedDecision[] = parsed.map((item: any) => ({
      title: String(item?.title ?? ""),
      nodeType: String(item?.nodeType ?? "context"),
      content: String(item?.content ?? ""),
      confidence: typeof item?.confidence === "number" ? item.confidence : 0,
    }));

    await appendCommandLogLine(this.workspaceRoot, ANALYZE_LOG_FILE_NAME, {
      event: "analyze.focused.summary",
      targetPath,
      decisionsCount: decisions.length,
    }).catch(() => {});

    return { decisions };
  }

  /**
   * Walks `resolvedPath` (a single file or a directory) collecting only
   * `isSupportedSourceFile()` matches, capped at `MAX_ANALYZE_FILES` files /
   * `MAX_ANALYZE_BYTES` cumulative bytes, whichever comes first. Files dropped by the cap
   * are returned (not silently discarded) so the caller can log what was left out.
   */
  private collectSourceFiles(resolvedPath: string): {
    files: CollectedFile[];
    droppedFiles: string[];
  } {
    const stat = fs.statSync(resolvedPath);
    const candidatePaths: string[] = stat.isDirectory()
      ? this.walkDirectory(resolvedPath)
      : [resolvedPath];

    const files: CollectedFile[] = [];
    const droppedFiles: string[] = [];
    let totalBytes = 0;

    for (const filePath of candidatePaths) {
      if (!isSupportedSourceFile(filePath)) continue;

      const relativePath = path.relative(this.workspaceRoot, filePath);

      if (files.length >= MAX_ANALYZE_FILES) {
        droppedFiles.push(relativePath);
        continue;
      }

      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch (err) {
        logger.warn({ filePath, err }, "Failed to read file for decision extraction");
        continue;
      }

      if (totalBytes + content.length > MAX_ANALYZE_BYTES) {
        droppedFiles.push(relativePath);
        continue;
      }

      totalBytes += content.length;
      files.push({ relativePath, content });
    }

    return { files, droppedFiles };
  }

  private walkDirectory(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".docuvia") {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkDirectory(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
    return results;
  }
}
