import { logger } from "../utils/logger.js";
import { AstEventStreamer } from "./ast/ast-event-streamer.js";
import { AstChangeDetector } from "./ast/ast-change-detector.js";
import { GitNativePersistenceService } from "./ast/git-native-persistence.service.js";
import { IngestionResult } from "../types/ast-ingestion.types.js";
import { FileIngestRequest } from "../interfaces/ast-ingestion.interfaces.js";
import { GitConstants } from "../constants/git.js";

/**
 * AstIngestionOrchestrator
 *
 * Orchestrates the AST ingestion pipeline using specialized services.
 */
export class AstIngestionOrchestrator {
  constructor(
    private streamer = new AstEventStreamer(),
    private changeDetector = new AstChangeDetector(),
    private gitPersistence = new GitNativePersistenceService()
  ) {}

  public async ingestAstJsonl(jsonlPath: string, projectId: number): Promise<IngestionResult> {
    const result: IngestionResult = {
      l2Created: 0,
      l3Created: 0,
      linksCreated: 0,
      contractsCreated: 0,
      filesSkipped: 0,
      errors: [],
    };

    const events = await this.streamer.streamAndCollectEvents(jsonlPath, result);

    const knowledgeRoot = process.env.KNOWLEDGE_ROOT || GitConstants.KNOWLEDGE_ROOT;
    await this.gitPersistence.processEvents(events, knowledgeRoot, result);

    return result;
  }

  public async ingestAstBatch(
    jsonlPaths: string[],
    projectId: number,
    options: { incremental?: boolean } = {}
  ): Promise<IngestionResult> {
    const aggregated: IngestionResult = {
      l2Created: 0,
      l3Created: 0,
      linksCreated: 0,
      contractsCreated: 0,
      filesSkipped: 0,
      errors: [],
    };

    const requests: FileIngestRequest[] = jsonlPaths.map((p) =>
      typeof p === "string" ? { filePath: p } : p
    );
    let pathsToIngest = requests.map((r) => r.filePath);
    if (options.incremental) {
      const changedFiles = await this.changeDetector.detectChangedFiles(projectId, requests);
      pathsToIngest = jsonlPaths.filter((p) => changedFiles.has(p));
      aggregated.filesSkipped = jsonlPaths.length - pathsToIngest.length;

      logger.info(
        {
          projectId,
          total: jsonlPaths.length,
          changed: pathsToIngest.length,
          skipped: aggregated.filesSkipped,
        },
        "AST incremental scan: change detection complete"
      );
    }

    for (const jsonlPath of pathsToIngest) {
      try {
        const result = await this.ingestAstJsonl(jsonlPath, projectId);
        aggregated.l2Created += result.l2Created;
        aggregated.l3Created += result.l3Created;
        aggregated.linksCreated += result.linksCreated;
        aggregated.contractsCreated += result.contractsCreated;
        aggregated.errors.push(...result.errors);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        aggregated.errors.push(`Failed to ingest ${jsonlPath}: ${errorMessage}`);
      }
    }

    if (options.incremental && pathsToIngest.length > 0) {
      try {
        await this.changeDetector.updateFileHashes(projectId, pathsToIngest);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        aggregated.errors.push(`Failed to update file hashes: ${errorMessage}`);
      }
    }

    return aggregated;
  }
}

// ── Exported Functions for Backward Compatibility ────────────────────

const orchestrator = new AstIngestionOrchestrator();

export async function ingestAstJsonl(
  jsonlPath: string,
  projectId: number
): Promise<IngestionResult> {
  return orchestrator.ingestAstJsonl(jsonlPath, projectId);
}

export async function ingestAstBatch(
  jsonlPaths: string[],
  projectId: number,
  options: { incremental?: boolean } = {}
): Promise<IngestionResult> {
  return orchestrator.ingestAstBatch(jsonlPaths, projectId, options);
}
