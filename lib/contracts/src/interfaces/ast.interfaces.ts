import type { DiscoveredFile } from "./discovery.interfaces.js";
import type {
  AstDeclaredTypeFacts,
  AstUtf16Span,
} from "./declared-type-facts.interfaces.js";
import type { AstCallSiteShapeFacts } from "./call-site-shape-facts.interfaces.js";

export const AstExportKinds = {
  FUNCTION: "function",
  CLASS: "class",
  VARIABLE: "variable",
  OTHER: "other",
} as const;
export type AstExportKind =
  (typeof AstExportKinds)[keyof typeof AstExportKinds];

export type AstReexportDescriptor =
  | {
      readonly kind: "named";
      readonly exportedName: string;
      readonly importedName: string;
      readonly modulePath: string;
      readonly isTypeOnly?: boolean;
    }
  | {
      readonly kind: "star";
      readonly exportedName: "*";
      readonly modulePath: string;
      readonly isTypeOnly?: boolean;
    }
  | {
      readonly kind: "namespace";
      readonly exportedName: string;
      readonly modulePath: string;
      readonly isTypeOnly?: boolean;
    }
  | {
      readonly kind: "local";
      readonly exportedName: string;
      readonly localName: string;
      readonly isTypeOnly?: boolean;
    };

export interface AstImportDescriptor {
  localName: string;
  originalName: string;
  modulePath: string;
  /** True when this descriptor came from a TS/JS barrel re-export
   *  (`export { X } from "./y"`, issue #192 gap 2) rather than a plain import statement --
   *  persist-ast-graph links these as file-level `depends_on` edges (a barrel depends on its
   *  source even though it has no call sites). */
  viaReexport?: boolean;
  /** True for TS `import type` and `import { type X }` bindings. */
  isTypeOnly?: boolean;
  /** True only for the default binding in an ordinary `import X, { y }` statement. */
  isCombinedDefaultImport?: boolean;
  /** True for an ordinary standalone `import X from "..."` default binding. */
  isDefaultImport?: boolean;
}

export interface AstExportDescriptor {
  readonly name: string;
  readonly type: AstExportKind;
  /** Exact declaration span for a direct `export default function` descriptor. */
  readonly declarationSpan?: AstUtf16Span;
}

export interface ParsedAstFileData {
  imports: AstImportDescriptor[];
  exports: AstExportDescriptor[];
  /** TS/JS export-clause syntax kept separate from imports so ScopeResolver inputs stay stable. */
  reexports?: AstReexportDescriptor[];
  functions: Array<{
    name: string;
    startLine: number;
    endLine: number;
    /** Exact tree-sitter source span for declaration-to-proof target mapping. */
    declarationSpan?: AstUtf16Span;
    contentHash?: string;
    containerName?: string; // NEW — the enclosing class/struct name, or undefined for a top-level function
  }>;
  classes: Array<{
    name: string;
    startLine: number;
    endLine: number;
    methods: string[];
    contentHash?: string;
  }>;
  /** Exported variable declarators (`export const X = ...`) — TS/JS only today (issue #192
   *  gap 1). Declarators whose initializer is an arrow_function/function_expression are
   *  excluded: they are already indexed as functions via the `functions` collector. */
  variables?: Array<{
    name: string;
    startLine: number;
    endLine: number;
    contentHash?: string;
  }>;
  /** One static call site. `startLine`/`startColumn` are the 0-based source position of the
   *  callee expression's start (Tier A's `startPosition` convention; column is a UTF-16 code-unit
   *  column, matching TypeScript offsets) -- the seed Tier B
   *  forward resolution (issue #11 plan A) issues `textDocument/definition` at this position per
   *  call site, see forward-tier-b-edge-resolution-plan.md Slice 1.
   *
   *  `targetFunction` is the raw callee expression text (e.g. `"service.doSomething"`), kept
   *  verbatim for Tier B seeding and #217's impact fallback. The optional decomposition fields
   *  (issue #192 root-cause fix) carry what name-based resolution actually needs:
   *  `calleeName` is the terminal callee identifier (`"doSomething"`), `receiverText` the
   *  receiver expression (`"service"`, `"this.logger"`), and `calleeKind` the shape classifier
   *  -- `'arg-chain'` (receiver is itself an invocation, e.g. `expect(x).toEqual`) and
   *  `'computed'` (`obj[expr]()`) are structurally unresolvable by name matching and excluded
   *  from resolution-rate denominators rather than counted as failures. All three may be
   *  undefined for pre-#192 producers. */
  calls: Array<{
    sourceFunction: string;
    targetFunction: string;
    startLine: number;
    startColumn: number;
    calleeName?: string;
    receiverText?: string;
    calleeKind?: "bare" | "member" | "this" | "arg-chain" | "computed";
  }>;
  implements?: Array<{ sourceClass: string; targetInterface: string }>;
  extends?: Array<{ sourceClass: string; targetClass: string }>;
  /** Optional source-only TypeScript/JavaScript syntax facts; older producers omit this versioned payload. */
  declaredTypeFacts?: AstDeclaredTypeFacts;
  /** Optional binding-scoped, syntax-only call features for candidate filtering. */
  callSiteShapeFacts?: AstCallSiteShapeFacts;
  /** `new Worker(<path>)` spawn sites (TS/JS only) — see `ast-worker.ts`'s `collectWorkerSpawns`. */
  workerSpawns?: Array<{ sourceFunction: string; targetPath: string }>;
  decisions?: string[];
}

export interface ParsedAstFileResult {
  file: string;
  /** Existing hybrid discovery hash persisted to project_files (Git blob SHA for clean tracked files, source SHA-256 otherwise). */
  hash: string;
  /** SHA-256 of the exact UTF-8 source passed to the parser; used for source-bound proof identities, not persisted as project_files.content_hash. */
  sourceContentHash?: string;
  data: ParsedAstFileData;
  /** Language detected for this file (e.g. "typescript"), or undefined if none of the registered language providers matched its extension. */
  language?: string;
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
  processFiles(
    workspaceRoot: string,
    filesToParse: DiscoveredFile[],
  ): Promise<AstProcessResult>;
}
