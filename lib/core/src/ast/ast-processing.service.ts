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
    // Serialized through the pool's exclusive batch lock: concurrent processFiles calls on a
    // shared pool (e.g. many docuvia processes analyzing one large project) queue instead of
    // interleaving their initialize()/parse()/terminate() worker lifecycles -- overlapping
    // batches were each spawning their own worker cohort and tearing each other down, the
    // memory-amplification/teardown race behind the "many processes on a large project"
    // crashes.
    return this.workerPool.serializeBatch(() =>
      this.runBatch(workspaceRoot, filesToParse),
    );
  }

  private async runBatch(
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

    // Slots keyed by the file's original index, not push-on-completion order: worker threads
    // settle in whatever order the pool schedules them, and pushing directly from each promise
    // as it resolves made `parsedResults`' row order (and therefore every downstream L2 rowid
    // assigned by `persist-ast-graph.ts`'s sequential inserts) depend on that race. Writing
    // into a fixed slot per index and flattening after the whole run settles restores
    // `filesToParse`'s own (git-diff-derived, deterministic) order regardless of completion timing.
    //
    // We submit ALL tasks to the pool at once rather than chunking into Promise.all() batches.
    // Fixed batching creates a synchronization barrier at every batch boundary: workers sit
    // idle once they've drained their share of the batch, waiting for the batch's single
    // slowest file before the next batch can even start. AstWorkerPool queues internally and
    // dispatches to whichever worker is next free, so submitting everything up front lets it
    // keep every worker fed for the whole run instead of only within each batch.
    //
    // Depends on AstWorkerPool.processQueue() draining its whole queue (not just one
    // task/worker pair) on every call, and spawnWorker() calling it after a crash respawn --
    // without both, a worker that becomes idle between batches' worth of new parse() calls
    // (which used to be what re-triggered dispatch) can go permanently unfed. See
    // ast-worker-pool.ts and ast-worker-pool.unit.test.ts's respawn-stranding regression test.
    const slots: Array<
      | { outcome: "parsed"; result: ParsedAstFileResult }
      | { outcome: "failed"; failure: AstParseFailure }
    > = new Array(filesToParse.length);

    const promises = filesToParse.map(async (item, idx) => {
      try {
        const res = await pool.parse({
          filePath: item.file,
          code: item.code,
          language: getLanguage(item.file),
        });
        if (res.success && res.data) {
          slots[idx] = {
            outcome: "parsed",
            result: {
              file: item.file,
              hash: item.hash,
              data: res.data,
              language: detectLanguageForFile(item.file),
            },
          };
        } else {
          const error = res.error ?? AstMessages.PARSE_FAILURE_NO_DETAIL;
          this.logger.warn(AstMessages.PARSE_FAILURE_RESULT, {
            file: item.file,
            error,
          });
          slots[idx] = {
            outcome: "failed",
            failure: { file: item.file, hash: item.hash, error },
          };
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
        slots[idx] = {
          outcome: "failed",
          failure: { file: item.file, hash: item.hash, error },
        };
      }
    });

    await Promise.all(promises);

    for (const slot of slots) {
      if (slot.outcome === "parsed") parsedResults.push(slot.result);
      else failures.push(slot.failure);
    }

    await pool.terminate();
    return { parsed: parsedResults, failures };
  }
}
