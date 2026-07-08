import os from "os";
import { AstWorkerPool } from "./ast-worker-pool.js";
import {
  DiscoveredFile,
  IAstProcessor,
  ParsedAstFileResult,
} from "../interfaces/analyzer.interfaces.js";
import { detectLanguageForFile } from "../utils/language-detection.js";

export class AstProcessingService implements IAstProcessor {
  public async processFiles(
    workspaceRoot: string,
    filesToParse: DiscoveredFile[]
  ): Promise<ParsedAstFileResult[]> {
    const workerCount = Math.max(1, (os.cpus().length || 4) - 1);
    const pool = new AstWorkerPool();
    await pool.initialize(workerCount);

    // Fallback preserved for behavioral parity — pre-existing smell (files with no detected
    // language shouldn't ideally be force-fed to the TS parser), but FileDiscoveryService already
    // filters to registry-supported extensions upstream, so this branch should rarely trigger.
    const getLanguage = (file: string) => detectLanguageForFile(file) ?? "typescript";

    const parsedResults: ParsedAstFileResult[] = [];
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
