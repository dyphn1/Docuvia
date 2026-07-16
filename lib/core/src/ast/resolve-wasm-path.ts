import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

/**
 * Resolves the on-disk path of a tree-sitter grammar's .wasm file, trying
 * package.json resolution first (works whether tree-sitter-wasms is hoisted
 * or nested under .pnpm) and falling back to a handful of known workspace
 * layouts otherwise.
 *
 * Extracted out of `ast-worker.ts` (which re-exports it for backward compatibility) so it can be
 * imported from the main thread — `ast-worker.ts` itself registers `worker_threads`-only side
 * effects (`parentPort?.on(...)`, process-level `uncaughtException`/`unhandledRejection`
 * handlers) at module scope that must never run outside an actual Worker.
 * `SemanticDiffAnalyzerService` (Tier A's classification pass, phase1-decision-integration.md
 * §6b) is the reason this needed to become importable from the main thread.
 */
export function resolveWasmPath(wasmFile: string): {
  wasmPath: string;
  attemptedPaths: string[];
} {
  const docuviaRoot = path.resolve(__dirname, "../../../../");
  const attemptedPaths: string[] = [];

  try {
    const packagePath = require.resolve(`tree-sitter-wasms/package.json`, {
      paths: [__dirname, docuviaRoot],
    });
    const wasmPath = path.join(path.dirname(packagePath), "out", wasmFile);
    attemptedPaths.push(wasmPath);
    if (fs.existsSync(wasmPath)) return { wasmPath, attemptedPaths };
  } catch {
    // fall through to explicit path candidates below
  }

  const candidates = [
    path.resolve(docuviaRoot, `node_modules/tree-sitter-wasms/out/${wasmFile}`),
    path.resolve(
      __dirname,
      `../../../node_modules/tree-sitter-wasms/out/${wasmFile}`,
    ),
    path.resolve(
      docuviaRoot,
      `node_modules/.pnpm/tree-sitter-wasms@0.1.13/node_modules/tree-sitter-wasms/out/${wasmFile}`,
    ),
    path.resolve(docuviaRoot, `artifacts/vscode-client/out/wasm/${wasmFile}`),
  ];

  for (const candidate of candidates) {
    attemptedPaths.push(candidate);
    if (fs.existsSync(candidate))
      return { wasmPath: candidate, attemptedPaths };
  }

  return { wasmPath: candidates[candidates.length - 1], attemptedPaths };
}
