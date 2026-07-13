import type { DiscoveredFile } from "./discovery.interfaces.js";

export interface AstImportDescriptor {
  localName: string;
  originalName: string;
  modulePath: string;
}

export interface ParsedAstFileData {
  imports: AstImportDescriptor[];
  exports: Array<{ name: string; type: "function" | "class" | "variable" }>;
  functions: Array<{
    name: string;
    startLine: number;
    endLine: number;
    contentHash?: string;
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
