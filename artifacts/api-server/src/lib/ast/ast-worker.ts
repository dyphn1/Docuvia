import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Parser, Language } from 'web-tree-sitter';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let parserInitialized = false;

async function initParser() {
  if (!parserInitialized) {
    const wasmPath = path.join(path.dirname(require.resolve('web-tree-sitter')), 'web-tree-sitter.wasm');
    await Parser.init({ locateFile: () => wasmPath });
    parserInitialized = true;
  }
}

// Dummy/stub loader for WASM grammars (to be implemented in Phase 2)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function loadLanguage(ext: string): Promise<Language | null> {
  // e.g. download or load from disk based on extension
  return null; 
}

// In Piscina, the default export is the worker function
export default async function parseAst(filePath: string): Promise<{ status: string; file: string }> {
  await initParser();

  // We initialize the parser but don't parse anything since we are using a dummy implementation for Phase 1.
  // const parser = new Parser();
  // const ext = path.extname(filePath);
  // const lang = await loadLanguage(ext);
  // if (lang) parser.setLanguage(lang);

  // File-Based IPC Bypass: JSONL Spooling (ADR-009)
  const tempFileName = `ast-skeleton-${crypto.randomBytes(8).toString('hex')}.jsonl`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);

  const skeleton = [
    JSON.stringify({ type: 'file', path: filePath }),
    JSON.stringify({ type: 'class', name: 'DummyClass' }),
    JSON.stringify({ type: 'function', name: 'dummyFunction' })
  ];

  await fs.writeFile(tempFilePath, skeleton.join('\n') + '\n', 'utf-8');

  return { status: 'done', file: tempFilePath };
}
