import type { AstParseResponse } from "../workers/ast-worker.js";

/** A file discovered on disk that still needs to be parsed (new or content-hash changed). */
export interface DiscoveredFile {
  file: string;
  hash: string;
  code: string;
}

/** The AST-worker's parse output (imports/exports/functions/classes/calls/implements/extends). */
export type ParsedAstFileData = NonNullable<AstParseResponse["data"]>;

export interface ParsedAstFileResult {
  file: string;
  hash: string;
  data: ParsedAstFileData;
}

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
  ): Promise<{
    filesToParse: DiscoveredFile[];
    existingHashes: Map<string, string>;
    skippedCount: number;
  }>;
}

export interface IGraphDatabaseRepository {
  persistAstGraph(
    workspaceRoot: string,
    parsedResults: ParsedAstFileResult[],
    tags: string[]
  ): Promise<{ updatedCount: number; fileIdMap: Map<string, number> }>;
}

export interface AstParseFailure {
  file: string;
  hash: string;
  error: string;
}

export interface AstProcessResult {
  parsed: ParsedAstFileResult[];
  failures: AstParseFailure[];
}

export interface IAstProcessor {
  processFiles(workspaceRoot: string, filesToParse: DiscoveredFile[]): Promise<AstProcessResult>;
}

export interface IL3ExtractionJob {
  triggerBackgroundExtraction(
    workspaceRoot: string,
    filesToParse: DiscoveredFile[],
    fileIdMap: Map<string, number>
  ): void;
}
