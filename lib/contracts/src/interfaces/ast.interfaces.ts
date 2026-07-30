import type { DiscoveredFile } from "./discovery.interfaces.js";

export const AstExportKinds = {
  FUNCTION: "function",
  CLASS: "class",
  VARIABLE: "variable",
} as const;
export type AstExportKind =
  (typeof AstExportKinds)[keyof typeof AstExportKinds];

export interface AstImportDescriptor {
  localName: string;
  originalName: string;
  modulePath: string;
}

export interface ParsedAstFileData {
  imports: AstImportDescriptor[];
  exports: Array<{ name: string; type: AstExportKind }>;
  functions: Array<{
    name: string;
    startLine: number;
    endLine: number;
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
  calls: Array<{ sourceFunction: string; targetFunction: string }>;
  implements?: Array<{ sourceClass: string; targetInterface: string }>;
  extends?: Array<{ sourceClass: string; targetClass: string }>;
  /** `new Worker(<path>)` spawn sites (TS/JS only) — see `ast-worker.ts`'s `collectWorkerSpawns`. */
  workerSpawns?: Array<{ sourceFunction: string; targetPath: string }>;
  decisions?: string[];
}

export interface ParsedAstFileResult {
  file: string;
  hash: string;
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
