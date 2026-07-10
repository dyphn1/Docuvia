import os from "os";
import { AstWorkerPool, AstWorkerCrashError, IASTWorkerPool } from "./ast-worker-pool.js";
import {
  AstParseFailure,
  AstProcessResult,
  DiscoveredFile,
  IAstProcessor,
  ParsedAstFileResult,
} from "../interfaces/analyzer.interfaces.js";
import { detectLanguageForFile } from "../utils/language-detection.js";
import { logger } from "../utils/logger.js";

export class AstProcessingService implements IAstProcessor {
  constructor(private readonly workerPool?: IASTWorkerPool) {}

  public async processFiles(
    workspaceRoot: string,
    filesToParse: DiscoveredFile[]
  ): Promise<AstProcessResult> {
    const workerCount = Math.max(1, (os.cpus().length || 4) - 1);
    const pool = this.workerPool ?? new AstWorkerPool();
    await pool.initialize(workerCount);

    // Fallback preserved for behavioral parity — pre-existing smell (files with no detected
    // language shouldn't ideally be force-fed to the TS parser), but FileDiscoveryService already
    // filters to registry-supported extensions upstream, so this branch should rarely trigger.
    const getLanguage = (file: string) => detectLanguageForFile(file) ?? "typescript";

    const parsedResults: ParsedAstFileResult[] = [];
    const failures: AstParseFailure[] = [];
    const batchSize = 50;
    for (let i = 0; i < filesToParse.length; i += batchSize) {
      const batch = filesToParse.slice(i, i + batchSize);
      const promises = batch.map(async (item) => {
        try {
          const res = await pool.parse({
            filePath: item.file,
            code: item.code,
            language: getLanguage(item.file),
          });
          if (res.success && res.data) {
            parsedResults.push({ file: item.file, hash: item.hash, data: res.data });
          } else {
            const error = res.error ?? "parse returned success=false with no error detail";
            logger.warn({ file: item.file, error }, "AST parse returned failure result");
            failures.push({ file: item.file, hash: item.hash, error });
          }
        } catch (e) {
          const error =
            e instanceof AstWorkerCrashError
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e);
          logger.error({ file: item.file, error }, "AST parse threw (worker crash or rejection)");
          failures.push({ file: item.file, hash: item.hash, error });
        }
      });
      await Promise.all(promises);
    }

    await pool.terminate();
    return { parsed: parsedResults, failures };
  }
}
