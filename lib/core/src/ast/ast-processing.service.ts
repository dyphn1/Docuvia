import os from "os";
import { AstWorkerCrashError, type IASTWorkerPool } from "./ast-worker-pool.js";
import type {
  AstParseFailure,
  AstProcessResult,
  DiscoveredFile,
  IAstProcessor,
  ILogger,
  ParsedAstFileResult,
} from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import { SUPPORTED_LANGUAGES } from "@workspace/ast-core";
import { detectLanguageForFile } from "../utils/language-detection.js";
import { AstMessages } from "./ast-constants.js";

export class AstProcessingService implements IAstProcessor {
  // `workerPool` is a required constructor parameter — no `?? new AstWorkerPool()` default.
  // Only `lib/ui-core`'s composition is allowed to construct a concrete service.
  constructor(
    private readonly workerPool: IASTWorkerPool,
    private readonly logger: ILogger = createNoopLogger(),
  ) {}

  public async processFiles(
    workspaceRoot: string,
    filesToParse: DiscoveredFile[],
  ): Promise<AstProcessResult> {
    const pool = this.workerPool;
    const workerCount = Math.max(1, (os.cpus().length || 4) - 1);
    await pool.initialize(workerCount);

    // Fallback preserved for behavioral parity — pre-existing smell (files with no detected
    // language shouldn't ideally be force-fed to the TS parser), but FileDiscoveryService already
    // filters to registry-supported extensions upstream, so this branch should rarely trigger.
    const getLanguage = (file: string) =>
      detectLanguageForFile(file) ?? SUPPORTED_LANGUAGES.TYPESCRIPT;

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
            parsedResults.push({
              file: item.file,
              hash: item.hash,
              data: res.data,
              language: detectLanguageForFile(item.file),
            });
          } else {
            const error = res.error ?? AstMessages.PARSE_FAILURE_NO_DETAIL;
            this.logger.warn(AstMessages.PARSE_FAILURE_RESULT, {
              file: item.file,
              error,
            });
            failures.push({ file: item.file, hash: item.hash, error });
          }
        } catch (e) {
          const error =
            e instanceof AstWorkerCrashError
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e);
          this.logger.error(AstMessages.PARSE_THREW, {
            file: item.file,
            error,
          });
          failures.push({ file: item.file, hash: item.hash, error });
        }
      });
      await Promise.all(promises);
    }

    await pool.terminate();
    return { parsed: parsedResults, failures };
  }
}
