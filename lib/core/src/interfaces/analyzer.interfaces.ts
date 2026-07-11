import type { AstParseResponse } from "../workers/ast-worker.js";
import type { ProjectFilesRepo } from "../memory/repos/files-repo.js";

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

/**
 * Old Docuvia's `IFileDiscovery.discoverFiles` took a raw `dbPath: string` and opened its
 * own `better-sqlite3` connection internally just to read existing content hashes — one of
 * the "9 files independently open their own connection" instances the memory-layer rework
 * (`GraphStore`) exists to eliminate. Replaced with the narrower `ProjectFilesRepo` (rather
 * than the full `GraphStore`) since hash-diffing is the *only* data-access this service ever
 * needs — passing the whole store would let it reach `projects`/`tags`/`graph`/`fts` it has
 * no business touching, undermining the point of segregating the interface at all.
 */
export interface IFileDiscovery {
  discoverFiles(
    workspaceRoot: string,
    filesRepo: ProjectFilesRepo,
    options?: { onlyIndexed?: boolean }
  ): Promise<{
    filesToParse: DiscoveredFile[];
    existingHashes: Map<string, string>;
    skippedCount: number;
    skippedOversized: { file: string; sizeBytes: number }[];
  }>;
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
