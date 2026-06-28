import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

export class LspEnrichmentService {
  private languageService: ts.LanguageService | null = null;
  private documentRegistry = ts.createDocumentRegistry();

  constructor(private workspaceRoot: string) {}

  private initLanguageService() {
    if (this.languageService) return;

    const tsconfigPath = ts.findConfigFile(this.workspaceRoot, ts.sys.fileExists, "tsconfig.json");
    if (!tsconfigPath) {
      throw new Error("Could not find a valid 'tsconfig.json'.");
    }

    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const parsedCommandLine = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(tsconfigPath)
    );

    const scriptVersions = new Map<string, number>();

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => parsedCommandLine.fileNames,
      getScriptVersion: (fileName) => {
        const version = scriptVersions.get(fileName);
        return version ? version.toString() : "0";
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

    this.languageService = ts.createLanguageService(host, this.documentRegistry);
  }

  public enrichImpact(symbolName: string, filePath: string): Array<{ file: string; line: number; text: string }> {
    this.initLanguageService();

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

    const references = this.languageService!.findReferences(filePath, position);
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
              text: line.trim()
            });
            break;
          }
          currentPos += line.length + 1; // +1 for newline
          lineNo++;
        }
      }
    }

    return results;
  }
}
