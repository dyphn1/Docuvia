import { DiscoveredFile, IConfigScanner, IFileDiscovery, IVcsScanner } from "../../interfaces/analyzer.interfaces.js";
import type { ProjectFilesRepo } from "../../memory/repos/files-repo.js";

export interface DiscoveryPipelineResult {
  filesToParse: DiscoveredFile[];
  skippedOversized: { file: string; sizeBytes: number }[];
  /** Merged config-scan + VCS-hotspot tags (per-file language tags are added later, once
   *  parsing has actually run — see `run-parse-and-persist.ts`). */
  tags: Set<string>;
  projectType: string;
}

/**
 * Phase 3 of `InitCommand.execute()`: ported from old `InitService.init()`'s step 4's first
 * half — the parallel `configScanner.scanConfigs()` + `vcsScanner.extractHotspotTags()` +
 * `fileDiscovery.discoverFiles()` `Promise.all([...])`, plus the tag-set merge that followed
 * it (config tags ∪ hotspot tags; per-file language tags are merged in separately by
 * `run-parse-and-persist.ts` once `astProcessor.processFiles()` has actually run).
 */
export async function runDiscoveryPipeline(deps: {
  configScanner: IConfigScanner;
  vcsScanner: IVcsScanner;
  fileDiscovery: IFileDiscovery;
  filesRepo: ProjectFilesRepo;
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
