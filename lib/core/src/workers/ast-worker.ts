import { parentPort } from "worker_threads";
import { Parser, Language } from "web-tree-sitter";
import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

export interface AstParseRequest {
  taskId: string;
  filePath: string;
  code: string;
  language: "typescript" | "python" | "rust" | "go" | "cpp" | "java" | "ruby" | "php";
}

export interface ImportDescriptor {
  localName: string;
  originalName: string;
  modulePath: string;
}

export interface AstParseResponse {
  taskId: string;
  success: boolean;
  error?: string;
  data?: {
    imports: ImportDescriptor[];
    exports: Array<{ name: string; type: "function" | "class" | "variable" }>;
    functions: Array<{ name: string; startLine: number; endLine: number }>;
    classes: Array<{ name: string; startLine: number; endLine: number; methods: string[] }>;
    calls: Array<{ sourceFunction: string; targetFunction: string }>;
    decisions?: string[];
  };
}

let parserInitialized = false;

parentPort?.on("message", async (request: AstParseRequest) => {
  try {
    if (!parserInitialized) {
      await Parser.init();
      parserInitialized = true;
    }

    const parser = new Parser();

    // Attempt to load wasm
    let languageLoaded = false;
    try {
      const docuviaRoot = path.resolve(__dirname, "../../../../");
      // Use require.resolve to safely find tree-sitter-wasms no matter if it's hoisted or in .pnpm
      let wasmPath = "";
      try {
        const packagePath = require.resolve(`tree-sitter-wasms/package.json`, {
          paths: [docuviaRoot],
        });
        wasmPath = path.join(
          path.dirname(packagePath),
          "out",
          `tree-sitter-${request.language}.wasm`
        );
      } catch (err) {
        // Fallback to explicit path if package.json resolve fails
        wasmPath = path.resolve(
          docuviaRoot,
          `node_modules/tree-sitter-wasms/out/tree-sitter-${request.language}.wasm`
        );
      }

      if (fs.existsSync(wasmPath)) {
        const wasmBytes = fs.readFileSync(wasmPath);
        const lang = await Language.load(wasmBytes);
        parser.setLanguage(lang);
        languageLoaded = true;
      } else {
        // Ultimate fallback for pnpm structures
        const pnpmAltPath = path.resolve(
          docuviaRoot,
          `node_modules/.pnpm/tree-sitter-wasms@0.1.13/node_modules/tree-sitter-wasms/out/tree-sitter-${request.language}.wasm`
        );
        if (fs.existsSync(pnpmAltPath)) {
          const wasmBytes = fs.readFileSync(pnpmAltPath);
          const lang = await Language.load(wasmBytes);
          parser.setLanguage(lang);
          languageLoaded = true;
        } else {
          console.warn(`[ast-worker] WASM not found at ${wasmPath}, falling back to mock`);
        }
      }
    } catch (e) {
      console.warn("[ast-worker] Failed to load wasm, falling back to mock", e);
    }

    if (!languageLoaded) {
      parser.delete();
      parentPort?.postMessage({
        taskId: request.taskId,
        success: false,
        error: `Failed to load tree-sitter language for ${request.language}`,
      });
      return;
    }

    // Parse the code using Tree-sitter
    const tree = parser.parse(request.code);

    const decisions: string[] = [];
    if (tree) {
      decisions.push(`Parsed via web-tree-sitter (nodes: ${tree.rootNode.childCount})`);
    }

    // TODO: Implement actual tree-sitter queries for imports, exports, functions, classes, and calls
    const imports: ImportDescriptor[] = [];
    const calls: Array<{ sourceFunction: string; targetFunction: string }> = [];

    const data = {
      imports,
      exports: [],
      functions: [],
      classes: [],
      calls,
      decisions,
    };

    if (tree) tree.delete();
    parser.delete();

    parentPort?.postMessage({
      taskId: request.taskId,
      success: true,
      data,
    });
  } catch (err: any) {
    parentPort?.postMessage({
      taskId: request.taskId,
      success: false,
      error: err.message,
    });
  }
});
