import os from "os";
import path from "path";
import { AstWorkerPool } from "./ast-worker-pool.js";
import { IAstProcessor } from "../interfaces/analyzer.interfaces.js";

export class AstProcessingService implements IAstProcessor {
  public async processFiles(workspaceRoot: string, filesToParse: any[]): Promise<any[]> {
    const workerCount = Math.max(1, (os.cpus().length || 4) - 1);
    const pool = new AstWorkerPool();
    await pool.initialize(workerCount);

    const getLanguage = (file: string) => {
      const ext = path.extname(file).toLowerCase();
      switch (ext) {
        case ".ts":
        case ".tsx":
        case ".js":
        case ".jsx":
          return "typescript";
        case ".py":
          return "python";
        case ".rs":
          return "rust";
        case ".go":
          return "go";
        case ".cpp":
        case ".cc":
        case ".c":
        case ".h":
        case ".hpp":
          return "cpp";
        case ".java":
          return "java";
        case ".rb":
          return "ruby";
        case ".php":
          return "php";
        default:
          return "typescript";
      }
    };

    const parsedResults: Array<{ file: string; hash: string; data: any }> = [];
    const batchSize = 50;
    for (let i = 0; i < filesToParse.length; i += batchSize) {
      const batch = filesToParse.slice(i, i + batchSize);
      const promises = batch.map(async (item) => {
        try {
          const res = await pool.parse({
            filePath: item.file,
            code: item.code,
            language: getLanguage(item.file),
          });
          if (res.success && res.data) {
            parsedResults.push({ file: item.file, hash: item.hash, data: res.data });
          } else {
            console.log(`[docuvia] parse returned false for ${item.file}: ${res.error}`);
          }
        } catch (e) {
          console.warn(`[docuvia] Failed to parse ${item.file}:`, e);
        }
      });
      await Promise.all(promises);
    }

    await pool.terminate();
    return parsedResults;
  }
}
