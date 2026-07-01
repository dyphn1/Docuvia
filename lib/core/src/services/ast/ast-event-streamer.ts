import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { IAstEventStreamer } from "../../interfaces/ast-ingestion.interfaces.js";
import {
  AstEvent,
  IngestionResult,
  ProcessedEvents,
  FileEvent,
  SymbolEvent,
  ImportEvent,
  CallEvent,
  ContractEvent,
} from "../../types/ast-ingestion.types.js";

// ── Index files that indicate a directory is a "package" ──────────
const PACKAGE_INDEX_FILES = new Set([
  "index.ts",
  "index.js",
  "index.tsx",
  "index.jsx",
  "__init__.py",
  "mod.rs",
  "lib.rs",
  "main.go",
  "package.java",
  "index.php",
  "index.rb",
]);

export class AstEventStreamer implements IAstEventStreamer {
  /**
   * Derive a Fully Qualified Name for an L3 symbol.
   * Format: `dir1/dir2/file.ext::symbolName`
   */
  private buildFqn(filePath: string, symbolName: string): string {
    const normalized = filePath.split(path.sep).join("/");
    return `${normalized}::${symbolName}`;
  }

  /**
   * Derive the directory path from a file path (normalized to forward slashes).
   */
  private getDirectoryPath(filePath: string): string {
    const normalized = filePath.split(path.sep).join("/");
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash > 0 ? normalized.substring(0, lastSlash) : ".";
  }

  /**
   * Classify an L2 node type based on the file path.
   */
  private classifyL2Type(filePath: string): "package" | "module" | "pcd" {
    const baseName = filePath.split(path.sep).pop() || filePath;
    if (PACKAGE_INDEX_FILES.has(baseName)) {
      return "package";
    }
    return "module";
  }

  /**
   * Build a path pattern for an L2 node.
   */
  private buildPathPattern(filePath: string, l2Type: string): string[] {
    const normalized = filePath.split(path.sep).join("/");
    if (l2Type === "package") {
      const dirPath = this.getDirectoryPath(normalized);
      return [`${dirPath}/*`];
    }
    return [normalized];
  }

  public async streamAndCollectEvents(
    jsonlPath: string,
    result: IngestionResult
  ): Promise<ProcessedEvents> {
    const fileEvents: FileEvent[] = [];
    const classEvents: SymbolEvent[] = [];
    const functionEvents: SymbolEvent[] = [];
    const importEvents: ImportEvent[] = [];
    const callEvents: CallEvent[] = [];
    const contractEvents: ContractEvent[] = [];
    let currentFilePath: string | null = null;

    const fileStream = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;

      let event: AstEvent;
      try {
        event = JSON.parse(line) as AstEvent;
      } catch (err: any) {
        result.errors.push(`JSON parse error: ${err.message}`);
        continue;
      }

      try {
        if (event.type === "file") {
          const filePath = event.path as string;
          if (!filePath) {
            result.errors.push("File event missing path");
            continue;
          }
          currentFilePath = filePath;
          const baseName = filePath.split(/[/\\]/).pop() || filePath;
          const dirPath = this.getDirectoryPath(filePath);
          const l2Type = this.classifyL2Type(filePath);
          const pathPatterns = this.buildPathPattern(filePath, l2Type);
          fileEvents.push({ filePath, baseName, dirPath, l2Type, pathPatterns });
        }

        if (event.type === "import") {
          const importSource = event.source as string;
          if (importSource && currentFilePath) {
            importEvents.push({
              source: importSource,
              localName: (event.localName as string) || "",
              importerFilePath: currentFilePath,
            });
          }
        }

        if (event.type === "class") {
          const name = event.name as string;
          if (name && currentFilePath) {
            classEvents.push({
              name,
              fqn: this.buildFqn(currentFilePath, name),
              filePath: currentFilePath,
              l2NodeId: 0,
              nodeType: "rule",
            });
          }
        }

        if (event.type === "function") {
          const name = event.name as string;
          if (name && currentFilePath) {
            functionEvents.push({
              name,
              fqn: this.buildFqn(currentFilePath, name),
              filePath: currentFilePath,
              l2NodeId: 0,
              nodeType: "change",
            });
          }
        }

        if (event.type === "call" || event.type === "method_call") {
          const callName = (event.name || event.method || "") as string;
          if (callName && currentFilePath) {
            callEvents.push({
              name: callName,
              method: event.method as string | undefined,
              object: event.object as string | undefined,
              callerFilePath: currentFilePath,
              isMethodCall: event.type === "method_call",
            });
          }
        }

        if (event.type === "api_contract") {
          const contractFilePath = (event.filePath || currentFilePath || "") as string;
          if (!contractFilePath) {
            result.errors.push("api_contract event missing filePath");
            continue;
          }
          currentFilePath = contractFilePath;

          const hasMethod = !!event.method;
          contractEvents.push({
            contractName: (event.contractName as string) || "",
            version: event.version as string | undefined,
            description: event.description as string | undefined,
            basePath: event.basePath as string | undefined,
            method: hasMethod ? (event.method as string) : undefined,
            path: hasMethod ? (event.path as string) : undefined,
            fullPath: hasMethod ? (event.fullPath as string) : undefined,
            summary: hasMethod ? (event.summary as string) : undefined,
            operationId: event.operationId as string | null | undefined,
            tags: event.tags as string[] | undefined,
            consumers: event.consumers as string[] | undefined,
            filePath: contractFilePath,
          });

          if (!hasMethod) {
            const baseName = contractFilePath.split(/[/\\]/).pop() || contractFilePath;
            const dirPath = this.getDirectoryPath(contractFilePath);
            fileEvents.push({
              filePath: contractFilePath,
              baseName,
              dirPath,
              l2Type: "pcd",
              pathPatterns: [contractFilePath],
            });
          }
        }
      } catch (err: any) {
        result.errors.push(`Event collection error (${event.type}): ${err.message}`);
      }
    }

    return { fileEvents, classEvents, functionEvents, importEvents, callEvents, contractEvents };
  }
}
