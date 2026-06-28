import { parentPort } from "worker_threads";
import * as ParserModule from "web-tree-sitter";
import * as path from "path";
import * as fs from "fs";

// Workaround for ESM/CJS interop issues with web-tree-sitter
const Parser = (ParserModule as any).default || ParserModule;

export interface AstParseRequest {
  taskId: string;
  filePath: string;
  code: string;
  language: "typescript" | "python" | "rust" | "go" | "cpp" | "java" | "ruby" | "php";
}

export interface AstParseResponse {
  taskId: string;
  success: boolean;
  error?: string;
  data?: {
    imports: Array<{ name: string; source: string; alias?: string }>;
    exports: Array<{ name: string; type: "function" | "class" | "variable" }>;
    functions: Array<{ name: string; startLine: number; endLine: number }>;
    classes: Array<{ name: string; startLine: number; endLine: number; methods: string[] }>;
    decisions?: string[];
  };
}

let parserInitialized = false;

parentPort?.on("message", async (request: AstParseRequest) => {
  try {
    if (!parserInitialized) {
      await (Parser as any).init();
      parserInitialized = true;
    }

    const parser = new (Parser as any)();
    
    // Attempt to load wasm
    let languageLoaded = false;
    try {
      const projectRoot = process.cwd();
      const wasmPath = path.resolve(projectRoot, `node_modules/tree-sitter-wasms/out/tree-sitter-${request.language}.wasm`);
      if (fs.existsSync(wasmPath)) {
        const lang = await (Parser as any).Language.load(wasmPath);
        parser.setLanguage(lang);
        languageLoaded = true;
      } else {
        // Fallback for Docuvia local project structure
        const altPath = path.resolve(projectRoot, `node_modules/.pnpm/tree-sitter-wasms@0.1.13/node_modules/tree-sitter-wasms/out/tree-sitter-${request.language}.wasm`);
        if (fs.existsSync(altPath)) {
          const lang = await (Parser as any).Language.load(altPath);
          parser.setLanguage(lang);
          languageLoaded = true;
        } else {
          console.warn(`[ast-worker] WASM not found, falling back to mock`);
        }
      }
    } catch (e) {
      console.warn("[ast-worker] Failed to load wasm, falling back to mock", e);
    }

    if (!languageLoaded) {
      // Mock logic as requested
      parser.delete();
      parentPort?.postMessage({
        taskId: request.taskId,
        success: true,
        data: {
          imports: [],
          exports: [],
          functions: [],
          classes: [],
          decisions: ["Extracted via Worker (Mocked AST parsing)"],
        }
      });
      return;
    }

    // Parse the code using Tree-sitter
    const tree = parser.parse(request.code);
    
    const decisions: string[] = [];
    if (tree) {
      decisions.push(`Parsed via web-tree-sitter (nodes: ${tree.rootNode.childCount})`);
    }

    const data = {
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      decisions
    };

    if (tree) tree.delete();
    parser.delete();

    parentPort?.postMessage({
      taskId: request.taskId,
      success: true,
      data
    });
  } catch (err: any) {
    parentPort?.postMessage({
      taskId: request.taskId,
      success: false,
      error: err.message
    });
  }
});
