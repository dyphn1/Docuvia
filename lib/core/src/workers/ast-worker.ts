import { parentPort } from "worker_threads";
import { Parser, Language, Query } from "web-tree-sitter";
import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import type { SupportedLanguage } from "@workspace/ast-core";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

export interface AstParseRequest {
  taskId: string;
  filePath: string;
  code: string;
  language: SupportedLanguage;
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
    let langInstance: Language | null = null;
    try {
      const docuviaRoot = path.resolve(__dirname, "../../../../");
      // Use require.resolve to safely find tree-sitter-wasms no matter if it's hoisted or in .pnpm
      let wasmPath = "";
      try {
        const packagePath = require.resolve(`tree-sitter-wasms/package.json`, {
          paths: [__dirname, docuviaRoot],
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
        
        // Another fallback for pnpm workspace structure
        if (!fs.existsSync(wasmPath)) {
          wasmPath = path.resolve(
            __dirname,
            `../../../node_modules/tree-sitter-wasms/out/tree-sitter-${request.language}.wasm`
          );
        }
      }

      if (fs.existsSync(wasmPath)) {
        const wasmBytes = fs.readFileSync(wasmPath);
        langInstance = await Language.load(wasmBytes);
        parser.setLanguage(langInstance);
        languageLoaded = true;
      } else {
        // Ultimate fallback for pnpm structures
        const pnpmAltPath = path.resolve(
          docuviaRoot,
          `node_modules/.pnpm/tree-sitter-wasms@0.1.13/node_modules/tree-sitter-wasms/out/tree-sitter-${request.language}.wasm`
        );
        if (fs.existsSync(pnpmAltPath)) {
          const wasmBytes = fs.readFileSync(pnpmAltPath);
          langInstance = await Language.load(wasmBytes);
          parser.setLanguage(langInstance);
          languageLoaded = true;
        } else {
          throw new Error(`[ast-worker] WASM not found at ${wasmPath}`);
        }
      }
    } catch (e) {
      throw new Error(`[ast-worker] Failed to load wasm: ${e instanceof Error ? e.message : e}`);
    }

    if (!languageLoaded) {
      parser.delete();
      throw new Error(`[ast-worker] Language grammar not loaded for ${request.language}`);
    }

    // Parse the code using Tree-sitter
    const tree = parser.parse(request.code);

    const decisions: string[] = [];
    if (tree) {
      decisions.push(`Parsed via web-tree-sitter (nodes: ${tree.rootNode.childCount})`);
    }

    const imports: ImportDescriptor[] = [];
    const exports: Array<{ name: string; type: "function" | "class" | "variable" }> = [];
    const functions: Array<{ name: string; startLine: number; endLine: number }> = [];
    const classes: Array<{ name: string; startLine: number; endLine: number; methods: string[] }> =
      [];
    const calls: Array<{ sourceFunction: string; targetFunction: string }> = [];

    if (tree && languageLoaded && langInstance) {
      try {
        let qStr = ``;
        if (request.language === "typescript") {
          qStr = `(import_statement (import_clause (named_imports (import_specifier name: (identifier) @import.name))) source: (string (string_fragment) @import.source))\n(import_statement (import_clause (identifier) @import.name) source: (string (string_fragment) @import.source))\n(export_statement (export_clause (export_specifier name: (identifier) @export.name)))\n(export_statement declaration: (function_declaration name: (identifier) @export.name))\n(export_statement declaration: (class_declaration name: (identifier) @export.name))\n(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @export.name)))\n(function_declaration name: (identifier) @function)\n(method_definition name: (property_identifier) @method)\n(class_declaration name: (identifier) @class)\n(call_expression function: (identifier) @call)`;
        } else {
          qStr = `(import_statement) @import\n(function_declaration) @function\n(method_definition) @method\n(class_declaration) @class`;
        }
        const q = new Query(langInstance, qStr);
        const matches = q.matches(tree.rootNode);

        const capturedNodes = new Set();
        for (const match of matches) {
          for (const capture of match.captures) {
            const node = capture.node;
            if (capturedNodes.has(node.id)) continue;
            capturedNodes.add(node.id);

            if (capture.name === "import") {
              imports.push({ localName: node.text, originalName: node.text, modulePath: "" });
            } else if (capture.name === "function" || capture.name === "method") {
              functions.push({
                name: node.childForFieldName("name")?.text || "anonymous",
                startLine: node.startPosition.row,
                endLine: node.endPosition.row,
              });
            } else if (capture.name === "class") {
              classes.push({
                name: node.childForFieldName("name")?.text || "anonymous",
                startLine: node.startPosition.row,
                endLine: node.endPosition.row,
                methods: [],
              });
            }
          }
        }
        decisions.push("Queried nodes using web-tree-sitter Query API");
      } catch (e) {
        decisions.push("Query API failed, using AST fallback traversal");
        const traverse = (node: any) => {
          if (node.type === "import_statement") {
            imports.push({ localName: node.text, originalName: node.text, modulePath: "" });
          } else if (node.type === "function_declaration" || node.type === "method_definition") {
            functions.push({
              name: node.childForFieldName("name")?.text || "anonymous",
              startLine: node.startPosition.row,
              endLine: node.endPosition.row,
            });
          } else if (node.type === "class_declaration") {
            classes.push({
              name: node.childForFieldName("name")?.text || "anonymous",
              startLine: node.startPosition.row,
              endLine: node.endPosition.row,
              methods: [],
            });
          }
          for (let i = 0; i < node.childCount; i++) {
            traverse(node.child(i));
          }
        };
        traverse(tree.rootNode);
      }
    }

    const data = {
      imports,
      exports,
      functions,
      classes,
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
