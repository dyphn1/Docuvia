import type { AstUtf16Span } from "./declared-type-facts.interfaces.js";
import type { CallResolutionHypothesisSourceFile } from "./call-resolution-hypothesis.interfaces.js";

/** Graph identity paired with a declaration target key for strict-proof projection. */
export interface CallResolutionFunctionNodeReference {
  readonly nodeKey: string;
  readonly name: string;
  readonly containerName?: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly declarationSpan?: AstUtf16Span;
  readonly declarationTargetKeys: readonly string[];
}

/** Version for source facts persisted beside each `project_files` row. */
export const CALL_RESOLUTION_SOURCE_INDEX_SCHEMA_VERSION = 3 as const;

/** Durable, parser-produced facts for one file in a complete proof index. */
export interface PersistedCallResolutionSourceFile {
  readonly schemaVersion: typeof CALL_RESOLUTION_SOURCE_INDEX_SCHEMA_VERSION;
  readonly sourceFile: CallResolutionHypothesisSourceFile;
  readonly functionNodeReferences: readonly CallResolutionFunctionNodeReference[];
  readonly resolverLocalSymbols: readonly string[];
}

/** A read of the durable source index. Any absent or invalid row makes it incomplete. */
export interface CallResolutionSourceIndexRead {
  readonly sourceFiles: readonly CallResolutionHypothesisSourceFile[];
  readonly functionNodeReferencesByFile: readonly {
    readonly filePath: string;
    readonly functionNodeReferences: readonly CallResolutionFunctionNodeReference[];
  }[];
  readonly resolverLocalSymbolsByFile: readonly {
    readonly filePath: string;
    readonly localSymbols: readonly string[];
  }[];
  readonly complete: boolean;
  readonly incompleteFilePaths: readonly string[];
}
