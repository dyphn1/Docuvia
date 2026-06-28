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
        const packagePath = require.resolve(`tree-sitter-wasms/package.json`, { paths: [docuviaRoot] });
        wasmPath = path.join(path.dirname(packagePath), "out", `tree-sitter-${request.language}.wasm`);
      } catch (err) {
        // Fallback to explicit path if package.json resolve fails
        wasmPath = path.resolve(docuviaRoot, `node_modules/tree-sitter-wasms/out/tree-sitter-${request.language}.wasm`);
      }

      if (fs.existsSync(wasmPath)) {
        const wasmBytes = fs.readFileSync(wasmPath);
        const lang = await Language.load(wasmBytes);
        parser.setLanguage(lang);
        languageLoaded = true;
      } else {
        // Ultimate fallback for pnpm structures
        const pnpmAltPath = path.resolve(docuviaRoot, `node_modules/.pnpm/tree-sitter-wasms@0.1.13/node_modules/tree-sitter-wasms/out/tree-sitter-${request.language}.wasm`);
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
      // Mock logic as requested
      parser.delete();
      
      // Basic regex fallback for TS/JS imports
      const imports: ImportDescriptor[] = [];
      const importRegex = /import\s+({[^}]+}|[^{;]+)\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(request.code)) !== null) {
        const specifiers = match[1].trim();
        const modulePath = match[2];
        if (specifiers.startsWith('{')) {
          const parts = specifiers.slice(1, -1).split(',');
          for (const p of parts) {
            const t = p.trim();
            if (!t) continue;
            const asIdx = t.indexOf(' as ');
            if (asIdx !== -1) {
              imports.push({
                localName: t.slice(asIdx + 4).trim(),
                originalName: t.slice(0, asIdx).trim(),
                modulePath
              });
            } else {
              imports.push({ localName: t, originalName: t, modulePath });
            }
          }
        } else {
          // default or namespace import
          if (specifiers.includes('* as ')) {
            imports.push({
              localName: specifiers.split(' as ')[1].trim(),
              originalName: '*',
              modulePath
            });
          } else {
            imports.push({
              localName: specifiers,
              originalName: 'default',
              modulePath
            });
          }
        }
      }
      
      const calls: Array<{ sourceFunction: string; targetFunction: string }> = [];
      // Basic regex for calls (naive)
      const callRegex = /([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/g;
      while ((match = callRegex.exec(request.code)) !== null) {
        // Skip some standard keywords
        if (['if', 'while', 'for', 'switch', 'catch', 'function'].includes(match[1])) continue;
        calls.push({ sourceFunction: "global", targetFunction: match[1] });
      }

      parentPort?.postMessage({
        taskId: request.taskId,
        success: true,
        data: {
          imports,
          exports: [],
          functions: [],
          classes: [],
          calls,
          decisions: ["Extracted via Worker (Mocked AST parsing + regex)"],
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

    // Basic regex fallback for TS/JS imports (even with tree-sitter active, as there are no queries configured here yet)
    const imports: ImportDescriptor[] = [];
    const importRegex = /import\s+({[^}]+}|[^{;]+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(request.code)) !== null) {
      const specifiers = match[1].trim();
      const modulePath = match[2];
      if (specifiers.startsWith('{')) {
        const parts = specifiers.slice(1, -1).split(',');
        for (const p of parts) {
          const t = p.trim();
          if (!t) continue;
          const asIdx = t.indexOf(' as ');
          if (asIdx !== -1) {
            imports.push({
              localName: t.slice(asIdx + 4).trim(),
              originalName: t.slice(0, asIdx).trim(),
              modulePath
            });
          } else {
            imports.push({ localName: t, originalName: t, modulePath });
          }
        }
      } else {
        if (specifiers.includes('* as ')) {
          imports.push({
            localName: specifiers.split(' as ')[1].trim(),
            originalName: '*',
            modulePath
          });
        } else {
          imports.push({
            localName: specifiers,
            originalName: 'default',
            modulePath
          });
        }
      }
    }
    
    const calls: Array<{ sourceFunction: string; targetFunction: string }> = [];
    const callRegex = /([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/g;
    while ((match = callRegex.exec(request.code)) !== null) {
      if (['if', 'while', 'for', 'switch', 'catch', 'function'].includes(match[1])) continue;
      calls.push({ sourceFunction: "global", targetFunction: match[1] });
    }

    const data = {
      imports,
      exports: [],
      functions: [],
      classes: [],
      calls,
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
