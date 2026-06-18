import { Parser } from 'web-tree-sitter';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wasmPath = path.join(path.dirname(require.resolve('web-tree-sitter')), 'web-tree-sitter.wasm');

console.log('wasm path:', wasmPath);
Parser.init({ locateFile: () => wasmPath }).then(() => console.log('success')).catch(console.error);
