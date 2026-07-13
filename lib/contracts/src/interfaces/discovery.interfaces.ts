/** A file discovered on disk that still needs to be parsed (new or content-hash changed). */
export interface DiscoveredFile {
  file: string;
  hash: string;
  code: string;
}

export interface DiscoveryResult {
  filesToParse: DiscoveredFile[];
  existingHashes: Map<string, string>;
  skippedCount: number;
  skippedOversized: { file: string; sizeBytes: number }[];
}

/** Narrow read/write surface `IFileDiscovery` needs from the files table — kept separate from
 *  the full `IProjectFilesRepo` so this service can only reach what hash-diffing requires. */
export interface FileHashLookup {
  getAllHashes(): Array<{ filePath: string; contentHash: string | null }>;
}

export interface IFileDiscovery {
  discoverFiles(
    workspaceRoot: string,
    filesRepo: FileHashLookup,
    options?: { onlyIndexed?: boolean },
  ): Promise<DiscoveryResult>;
}

export interface IConfigScanner {
  scanConfigs(
    workspaceRoot: string,
  ): Promise<{ projectType: string; tags: string[] }>;
}

export interface IVcsScanner {
  extractHotspotTags(workspaceRoot: string): Promise<string[]>;
}
