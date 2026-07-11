import type {
  AstParseFailure,
  DiscoveredFile,
  IAstProcessor,
  IGraphPersister,
  IGraphStore,
  ParsedAstFileResult,
} from "@workspace/contracts";
import { appendInitLogLine } from "./init-log-writer.js";

export interface RunParseAndPersistResult {
  parsedResults: ParsedAstFileResult[];
  failures: AstParseFailure[];
  tags: Set<string>;
}

/** Phase 4: AST parse, per-file language-tag merge, then hands off to `IGraphPersister` (the Domain Core service resolved from the factory) for graph persistence. */
export async function runParseAndPersist(deps: {
  astProcessor: IAstProcessor;
  graphPersister: IGraphPersister;
  store: IGraphStore;
  workspaceRoot: string;
  projectId: number;
  filesToParse: DiscoveredFile[];
  skippedOversized: { file: string; sizeBytes: number }[];
  /** Config + hotspot tags from `runDiscoveryPipeline`; a fresh `Set` is returned with per-file language tags folded in — the input is never mutated. */
  tags: Set<string>;
}): Promise<RunParseAndPersistResult> {
  const { astProcessor, graphPersister, store, workspaceRoot, projectId, filesToParse, skippedOversized } =
    deps;

  const { parsed: parsedResults, failures } = await astProcessor.processFiles(
    workspaceRoot,
    filesToParse
  );

  const tags = new Set(deps.tags);
  for (const result of parsedResults) {
    if (result.language) tags.add(result.language);
  }

  for (const failure of failures) {
    await appendInitLogLine(workspaceRoot, { event: "init.parse_failure", ...failure });
  }
  for (const skipped of skippedOversized) {
    await appendInitLogLine(workspaceRoot, { event: "init.file_skipped_oversized", ...skipped });
  }

  await graphPersister.persist({
    store,
    workspaceRoot,
    projectId,
    parsedResults,
    tags: Array.from(tags),
  });

  return { parsedResults, failures, tags };
}
