import path from "path";
import {
  IVcsScanner,
  IConfigScanner,
  IFileDiscovery,
  IGraphDatabaseRepository,
  IAstProcessor,
  IL3ExtractionJob,
} from "../interfaces/analyzer.interfaces.js";
import { VcsScannerService } from "./vcs-scanner.service.js";
import { ConfigScannerService } from "./config-scanner.service.js";
import { FileDiscoveryService } from "./file-discovery.service.js";
import { AstProcessingService } from "./ast-processing.service.js";
import { SqliteGraphRepository } from "./sqlite-graph.repository.js";
import { L3ExtractionJobService } from "./l3-extraction-job.service.js";

export class AnalyzeService {
  constructor(
    private workspaceRoot: string,
    private vcsScanner: IVcsScanner = new VcsScannerService(),
    private configScanner: IConfigScanner = new ConfigScannerService(),
    private fileDiscovery: IFileDiscovery = new FileDiscoveryService(),
    private astProcessor: IAstProcessor = new AstProcessingService(),
    private graphDbRepo: IGraphDatabaseRepository = new SqliteGraphRepository(),
    private l3Job: IL3ExtractionJob = new L3ExtractionJobService()
  ) {}

  public async analyzeProject(options?: {
    deep?: boolean;
  }): Promise<{ projectType: string; suggestedTags: string[] }> {
    console.log(`[docuvia] Analyzing project in ${this.workspaceRoot}`);

    // 1. Gather Tags from VCS and Config
    const vcsTags = await this.vcsScanner.extractHotspotTags(this.workspaceRoot);
    const configResult = await this.configScanner.scanConfigs(this.workspaceRoot);

    const suggestedTags = new Set([...vcsTags, ...configResult.tags]);

    // 2. Discover files
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    const discoveryResult = await this.fileDiscovery.discoverFiles(this.workspaceRoot, dbPath);

    const { filesToParse, skippedCount } = discoveryResult;

    // 3. Process ASTs
    let globalFileIdMap = new Map<string, number>();
    let updatedCount = 0;

    if (filesToParse.length > 0) {
      const parsedResults = await this.astProcessor.processFiles(this.workspaceRoot, filesToParse);

      // 4. Persist to DB
      const persistResult = await this.graphDbRepo.persistAstGraph(
        this.workspaceRoot,
        parsedResults,
        Array.from(suggestedTags)
      );
      globalFileIdMap = persistResult.fileIdMap;
      updatedCount = persistResult.updatedCount;
      console.log(
        `[docuvia] AST scan complete: ${updatedCount} updated, ${skippedCount} skipped (unchanged).`
      );
    } else {
      console.log(`[docuvia] AST scan complete: 0 updated, ${skippedCount} skipped (unchanged).`);
    }

    // 5. Trigger L3 Job if deep = true
    if (options?.deep) {
      this.l3Job.triggerBackgroundExtraction(this.workspaceRoot, filesToParse, globalFileIdMap);
    }

    return {
      projectType: configResult.projectType,
      suggestedTags: Array.from(suggestedTags),
    };
  }
}
