import type {
  DiscoveredFile,
  FileHashLookup,
  IConfigScanner,
  IFileDiscovery,
  IVcsScanner,
} from "@workspace/contracts";

export interface DiscoveryPipelineResult {
  filesToParse: DiscoveredFile[];
  skippedOversized: { file: string; sizeBytes: number }[];
  /** Merged config-scan + VCS-hotspot tags (per-file language tags are added later, once parsing has actually run — see `run-parse-and-persist.ts`). */
  tags: Set<string>;
  projectType: string;
}

/** Phase 3: the parallel config/VCS-hotspot/file-discovery scan, plus the tag-set merge that follows it. */
export async function runDiscoveryPipeline(deps: {
  configScanner: IConfigScanner;
  vcsScanner: IVcsScanner;
  fileDiscovery: IFileDiscovery;
  filesRepo: FileHashLookup;
  workspaceRoot: string;
}): Promise<DiscoveryPipelineResult> {
  const [configResult, hotspotTags, discovery] = await Promise.all([
    deps.configScanner.scanConfigs(deps.workspaceRoot),
    deps.vcsScanner.extractHotspotTags(deps.workspaceRoot),
    deps.fileDiscovery.discoverFiles(deps.workspaceRoot, deps.filesRepo),
  ]);

  const tags = new Set<string>([...configResult.tags, ...hotspotTags]);

  return {
    filesToParse: discovery.filesToParse,
    skippedOversized: discovery.skippedOversized,
    tags,
    projectType: configResult.projectType,
  };
}
