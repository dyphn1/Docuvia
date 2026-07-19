import * as path from "path";
import * as fs from "fs";
import { Parser, Language } from "web-tree-sitter";
import { SemanticDiffDetector } from "@workspace/ast-core";
import type { LanguageRegistry } from "@workspace/ast-core";
import { loadDefaultRegistry } from "@workspace/plugins-ast";
import type {
  ILogger,
  ISemanticDiffAnalyzer,
  SemanticDiffModifiedNode,
} from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import { resolveWasmPath } from "../ast/resolve-wasm-path.js";
import { SemanticDiffMessages } from "./semantic-diff-messages.js";

/**
 * Classification-only wrapper around `lib/ast-core`'s `SemanticDiffDetector` — `analyze` auto
 * mode's delta ingestion (phase1-decision-integration.md §6b; PLAT-007 Tier A) resolves this by
 * token per run, so the constructor's caches are naturally scoped to one `analyze` invocation.
 *
 * Bootstraps its own `Parser`/`Language` per language (mirrors `ast-worker.ts`'s production wasm
 * resolution — `resolveWasmPath` + `LanguageRegistry.getProviderForExtension`), independent of
 * `AstWorkerPool`'s worker-thread pool: this classification pass is a lightweight, main-thread,
 * best-effort step (never the sole gate on re-parsing — see the interface doc comment), so
 * spinning up a whole worker pool for it would be needless overhead.
 */
export class SemanticDiffAnalyzerService implements ISemanticDiffAnalyzer {
  private registryPromise?: Promise<LanguageRegistry>;
  private parserInitPromise?: Promise<void>;
  /** Keyed by grammar wasm file name — `null` means "tried and unavailable", cached so a missing
   *  grammar isn't re-attempted (and re-logged) for every file of that language in one run. */
  private readonly detectors = new Map<string, SemanticDiffDetector | null>();

  constructor(private readonly logger: ILogger = createNoopLogger()) {}

  public async analyzeFile(input: {
    filePath: string;
    oldContent: string;
    newContent: string;
    changedLineRanges: Array<{ startRow: number; endRow: number }>;
  }): Promise<SemanticDiffModifiedNode[]> {
    const { filePath, oldContent, newContent, changedLineRanges } = input;
    if (changedLineRanges.length === 0) return [];

    const detector = await this.getDetectorForFile(filePath);
    if (!detector) return [];

    try {
      const results = detector.analyze(
        oldContent,
        newContent,
        changedLineRanges,
      );
      // `PruningLevel` is a numeric enum (0 = INTERNAL_LOGIC, 1 = CONTRACT_CHANGED) — map to the
      // contract's plain `0 | 1` literal type rather than an `as` cast, since a TS enum member
      // type doesn't structurally narrow to a literal union on its own.
      return results.map((r) => ({
        nodeId: r.nodeId,
        nodeType: r.nodeType,
        pruningLevel: (r.pruningLevel === 1 ? 1 : 0) as 0 | 1,
        newRange: r.newRange,
      }));
    } catch (err) {
      this.logger.warn(SemanticDiffMessages.DETECTOR_FAILED, {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async getDetectorForFile(
    filePath: string,
  ): Promise<SemanticDiffDetector | undefined> {
    const registry = await this.getRegistry();
    const ext = path.extname(filePath);
    const provider = registry.getProviderForExtension(ext);
    if (!provider) return undefined;

    const cached = this.detectors.get(provider.wasm_file);
    if (cached !== undefined) return cached ?? undefined;

    this.parserInitPromise ??= Parser.init();
    await this.parserInitPromise;

    const { wasmPath, attemptedPaths } = resolveWasmPath(provider.wasm_file);
    if (!fs.existsSync(wasmPath)) {
      this.logger.debug(SemanticDiffMessages.NO_GRAMMAR_AVAILABLE, {
        filePath,
        wasmFile: provider.wasm_file,
        attemptedPaths,
      });
      this.detectors.set(provider.wasm_file, null);
      return undefined;
    }

    try {
      const lang = await Language.load(wasmPath);
      const parser = new Parser();
      const detector = new SemanticDiffDetector(parser, lang);
      this.detectors.set(provider.wasm_file, detector);
      return detector;
    } catch (err) {
      this.logger.warn(SemanticDiffMessages.GRAMMAR_LOAD_FAILED, {
        filePath,
        wasmFile: provider.wasm_file,
        error: err instanceof Error ? err.message : String(err),
      });
      this.detectors.set(provider.wasm_file, null);
      return undefined;
    }
  }

  private getRegistry(): Promise<LanguageRegistry> {
    this.registryPromise ??= loadDefaultRegistry();
    return this.registryPromise;
  }
}
