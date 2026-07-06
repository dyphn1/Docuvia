import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger.js";

// A cold `ts.createLanguageService` build (parsing the whole tsconfig project graph) can take
// seconds on a real monorepo. Callers like the VS Code hover provider construct a new
// LspEnrichmentService per request, so the warm LanguageService is cached here, keyed by
// workspace root, to pay that cost once per workspace instead of once per hover/query.
const languageServiceCache = new Map<string, ts.LanguageService>();
const sharedDocumentRegistry = ts.createDocumentRegistry();

export class LspEnrichmentService {
  private languageService: ts.LanguageService | null = null;

  constructor(private workspaceRoot: string) {}

  private initLanguageService() {
    const cacheKey = path.resolve(this.workspaceRoot);
    const cached = languageServiceCache.get(cacheKey);
    if (cached) {
      this.languageService = cached;
      return;
    }

    // Graceful degradation: a missing/malformed tsconfig.json (or any other project-graph parse
    // failure) must not take down the base SQLite blast-radius result — just skip LSP enrichment.
    let tsconfigPath: string | undefined;
    try {
      tsconfigPath = ts.findConfigFile(this.workspaceRoot, ts.sys.fileExists, "tsconfig.json");
    } catch (err) {
      logger.warn(
        { err, workspaceRoot: this.workspaceRoot },
        "[lsp-enrichment] findConfigFile failed"
      );
      return;
    }

    if (!tsconfigPath) {
      logger.debug(
        { workspaceRoot: this.workspaceRoot },
        "[lsp-enrichment] No tsconfig.json found, skipping LSP enrichment"
      );
      return;
    }

    try {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const parsedCommandLine = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfigPath)
      );

      const host: ts.LanguageServiceHost = {
        getScriptFileNames: () => parsedCommandLine.fileNames,
        // mtime as version so a cached LanguageService still picks up on-disk edits instead of
        // serving a stale AST forever once reused across requests.
        getScriptVersion: (fileName) => {
          try {
            return String(fs.statSync(fileName).mtimeMs);
          } catch {
            return "0";
          }
        },
        getScriptSnapshot: (fileName) => {
          if (!fs.existsSync(fileName)) {
            return undefined;
          }
          return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, "utf8"));
        },
        getCurrentDirectory: () => this.workspaceRoot,
        getCompilationSettings: () => parsedCommandLine.options,
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
      };

      this.languageService = ts.createLanguageService(host, sharedDocumentRegistry);
      languageServiceCache.set(cacheKey, this.languageService);
    } catch (err) {
      logger.warn(
        { err, workspaceRoot: this.workspaceRoot },
        "[lsp-enrichment] Failed to initialize TypeScript language service, skipping LSP enrichment"
      );
    }
  }

  public enrichImpact(
    symbolName: string,
    filePath: string
  ): Array<{ file: string; line: number; text: string }> {
    this.initLanguageService();
    if (!this.languageService) return [];

    if (!fs.existsSync(filePath)) {
      return [];
    }

    const fileContent = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true);

    let position = -1;

    // Find the symbol position by searching through the AST or a string match
    // Simple string search for demonstration (we'll try to find an identifier)
    const regex = new RegExp(`\\b${symbolName}\\b`);
    const match = fileContent.match(regex);
    if (match && match.index !== undefined) {
      position = match.index;
    } else {
      return [];
    }

    try {
      const references = this.languageService.findReferences(filePath, position);
      if (!references) return [];

      const results: Array<{ file: string; line: number; text: string }> = [];

      for (const ref of references) {
        for (const entry of ref.references) {
          if (entry.isDefinition) continue;

          const refFileContent = fs.readFileSync(entry.fileName, "utf8");
          const lines = refFileContent.split("\n");
          const textSpan = entry.textSpan;

          // Calculate line number
          let currentPos = 0;
          let lineNo = 1;
          for (const line of lines) {
            if (currentPos + line.length >= textSpan.start) {
              results.push({
                file: entry.fileName,
                line: lineNo,
                text: line.trim(),
              });
              break;
            }
            currentPos += line.length + 1; // +1 for newline
            lineNo++;
          }
        }
      }

      return results;
    } catch (err) {
      logger.warn({ err, filePath, symbolName }, "[lsp-enrichment] findReferences failed");
      return [];
    }
  }
}
