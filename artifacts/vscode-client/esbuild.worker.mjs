import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const outDir = path.join(__dirname, 'out/worker');
const wasmDir = path.join(__dirname, 'out/wasm');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

if (!fs.existsSync(wasmDir)) {
  fs.mkdirSync(wasmDir, { recursive: true });
}

try {
  const treeSitterJsPath = require.resolve('web-tree-sitter', { paths: [__dirname] });
  const treeSitterWasmPath = path.resolve(path.dirname(treeSitterJsPath), 'web-tree-sitter.wasm');
  if (fs.existsSync(treeSitterWasmPath)) {
    fs.copyFileSync(treeSitterWasmPath, path.join(wasmDir, 'web-tree-sitter.wasm'));
  } else {
    console.warn('web-tree-sitter.wasm not found at', treeSitterWasmPath);
  }

  // Also copy grammar wasms from tree-sitter-wasms
  const treeSitterWasmsPath = require.resolve('tree-sitter-wasms/package.json', { paths: [__dirname, path.join(__dirname, '../api-server')] });
  const wasmsOutDir = path.join(path.dirname(treeSitterWasmsPath), 'out');
  if (fs.existsSync(wasmsOutDir)) {
    const files = fs.readdirSync(wasmsOutDir);
    for (const file of files) {
      if (file.endsWith('.wasm')) {
        fs.copyFileSync(path.join(wasmsOutDir, file), path.join(wasmDir, file));
      }
    }
  }
} catch (e) {
  console.warn('web-tree-sitter or tree-sitter-wasms could not be resolved', e);
}

const isWatch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: [path.join(__dirname, 'src/worker/ast.worker.ts')],
  bundle: true,
  format: 'iife',
  outfile: path.join(outDir, 'ast.worker.js'),
  platform: 'browser',
  target: 'es2022',
  minify: !isWatch,
  sourcemap: isWatch,
  external: ['fs', 'path', 'os', 'module', 'perf_hooks'], 
});

if (isWatch) {
  await ctx.watch();
  console.log('Watching for worker changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('Worker build complete.');
}
