import { logger } from "../utils/logger.js";
import { AstEventStreamer } from "./ast/ast-event-streamer.js";
import { AstChangeDetector } from "./ast/ast-change-detector.js";
import { AstL2PersistenceService } from "./ast/ast-l2-persistence.js";
import { AstL3PersistenceService } from "./ast/ast-l3-persistence.js";
import { AstEdgePersistenceService } from "./ast/ast-edge-persistence.js";
import { IngestionResult } from "../types/ast-ingestion.types.js";

/**
 * AstIngestionOrchestrator
 *
 * Orchestrates the AST ingestion pipeline using specialized services.
 */
export class AstIngestionOrchestrator {
  private streamer = new AstEventStreamer();
  private changeDetector = new AstChangeDetector();
  private l2Persistence = new AstL2PersistenceService();
  private l3Persistence = new AstL3PersistenceService();
  private edgePersistence = new AstEdgePersistenceService();

  public async ingestAstJsonl(jsonlPath: string, projectId: number): Promise<IngestionResult> {
    const result: IngestionResult = {
      l2Created: 0,
      l3Created: 0,
      linksCreated: 0,
      contractsCreated: 0,
      filesSkipped: 0,
      errors: [],
    };

    const { fileEvents, classEvents, functionEvents, importEvents, callEvents, contractEvents } =
      await this.streamer.streamAndCollectEvents(jsonlPath, result);

    const { filePathToL2Id, pathToL2Id } = await this.l2Persistence.processBatchL2Nodes(
      projectId,
      fileEvents,
      result
    );

    const { fqnToL3Id, nameToL3Id, l3IdToL2Id } = await this.l3Persistence.processBatchL3Nodes(
      projectId,
      classEvents,
      functionEvents,
      filePathToL2Id,
      result
    );

    const { contractEndpointToL3Id, contractPathToL2Id } =
      await this.l3Persistence.processBatchContractEndpoints(
        projectId,
        contractEvents,
        filePathToL2Id,
        nameToL3Id,
        l3IdToL2Id,
        result
      );

    await this.edgePersistence.processBatchLinks(
      projectId,
      importEvents,
      callEvents,
      contractEvents,
      filePathToL2Id,
      pathToL2Id,
      fqnToL3Id,
      contractEndpointToL3Id,
      nameToL3Id,
      l3IdToL2Id,
      contractPathToL2Id,
      result
    );

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

    let pathsToIngest = jsonlPaths;
    if (options.incremental) {
      const changedFiles = await this.changeDetector.detectChangedFiles(projectId, jsonlPaths);
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
      } catch (err: any) {
        aggregated.errors.push(`Failed to ingest ${jsonlPath}: ${err.message}`);
      }
    }

    if (options.incremental && pathsToIngest.length > 0) {
      try {
        await this.changeDetector.updateFileHashes(projectId, pathsToIngest);
      } catch (err: any) {
        aggregated.errors.push(`Failed to update file hashes: ${err.message}`);
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
