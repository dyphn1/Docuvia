export interface IVcsScanner {
  extractHotspotTags(workspaceRoot: string): Promise<string[]>;
}

export interface IConfigScanner {
  scanConfigs(workspaceRoot: string): Promise<{ projectType: string; tags: string[] }>;
}

export interface IFileDiscovery {
  discoverFiles(
    workspaceRoot: string,
    dbPath: string,
    options?: { onlyIndexed?: boolean }
  ): Promise<{ filesToParse: any[]; existingHashes: Map<string, string>; skippedCount: number }>;
}

export interface IGraphDatabaseRepository {
  persistAstGraph(
    workspaceRoot: string,
    parsedResults: any[],
    tags: string[]
  ): Promise<{ updatedCount: number; fileIdMap: Map<string, number> }>;
}

export interface IAstProcessor {
  processFiles(workspaceRoot: string, filesToParse: any[]): Promise<any[]>;
}

export interface IL3ExtractionJob {
  triggerBackgroundExtraction(
    workspaceRoot: string,
    filesToParse: any[],
    fileIdMap: Map<string, number>
  ): void;
}
