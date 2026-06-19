import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Parser, Language } from 'web-tree-sitter';

import { createRequire } from 'node:module';
import { LanguageRegistry } from './language-registry.js';
import { LanguageProvider } from './language-provider.js';

const require = createRequire(import.meta.url);
let parserInitialized = false;
let registry: LanguageRegistry | null = null;

const languageCache = new Map<string, Language>();

async function initParser() {
  if (!parserInitialized) {
    const wasmPath = path.join(path.dirname(require.resolve('web-tree-sitter')), 'web-tree-sitter.wasm');
    await Parser.init({ locateFile: () => wasmPath });
    parserInitialized = true;
  }
  if (!registry) {
    // Assuming the root is two levels up from artifacts/api-server, or process.cwd() is ok
    registry = await LanguageRegistry.load();
  }
}

async function loadLanguage(ext: string): Promise<{ lang: Language | null, provider: LanguageProvider | undefined }> {
  if (!registry) {
    throw new Error('Language registry not initialized');
  }

  const provider = registry.getProviderForExtension(ext);
  if (!provider) {
    return { lang: null, provider: undefined };
  }

  const wasmFileName = provider.wasm_file;

  if (languageCache.has(wasmFileName)) {
    return { lang: languageCache.get(wasmFileName)!, provider };
  }

  try {
    // Attempt to load the grammar from the current working directory's wasm folder or fallback to root
    const wasmPath = path.resolve(process.cwd(), wasmFileName);
    const lang = await Language.load(wasmPath);
    languageCache.set(wasmFileName, lang);
    return { lang, provider };
  } catch (error) {
    // Gracefully fail if wasm is not present yet
    return { lang: null, provider };
  }
}

export interface ParseResult {
  status: 'done' | 'error';
  file?: string;
  reason?: string;
}

// In Piscina, the default export is the worker function
export default async function parseAst(filePath: string): Promise<ParseResult> {
  await initParser();

  const fileContent = await fs.readFile(filePath, 'utf-8');
  const ext = path.extname(filePath);
  const { lang, provider } = await loadLanguage(ext);

  const parser = new Parser();
  if (lang && provider) {
    parser.setLanguage(lang);
  } else {
    // If we can't load the language, we can't parse it with tree-sitter.
    // Return early or fallback. We'll return early for this implementation.
    return { status: 'error', reason: `Language grammar not found for extension ${ext}` };
  }

  const tree = parser.parse(fileContent);
  if (!tree) {
    return { status: 'error', reason: 'Failed to parse file with tree-sitter' };
  }

  const scopeMap = new Map<string, string>();
  
  const importStatements = provider.extractImports(tree.rootNode);
  
  for (const stmt of importStatements) {
    const sourceNode = stmt.descendantsOfType('string').pop();
    if (!sourceNode) continue;
    const sourceText = sourceNode.text.replace(/['"]/g, '');

    const identifiers = stmt.descendantsOfType('identifier');
    for (const idNode of identifiers) {
      scopeMap.set(idNode.text, `${sourceText}::${idNode.text}`);
    }
  }

  const classDecls = provider.extractClasses(tree.rootNode);
  const functionDecls = provider.extractFunctions(tree.rootNode);
  const callExprs = provider.extractCalls(tree.rootNode);

  const skeleton = [];
  skeleton.push(JSON.stringify({ type: 'file', path: filePath }));

  for (const cls of classDecls) {
    const nameNode = cls.childForFieldName('name') || cls.descendantsOfType('identifier')[0];
    if (nameNode) {
      skeleton.push(JSON.stringify({ type: 'class', name: nameNode.text }));
    }
  }

  for (const fn of functionDecls) {
    const nameNode = fn.childForFieldName('name') || fn.descendantsOfType('identifier')[0];
    if (nameNode) {
      skeleton.push(JSON.stringify({ type: 'function', name: nameNode.text }));
    }
  }

  const baseName = path.basename(filePath);
  for (const call of callExprs) {
    const functionNameNode = call.childForFieldName('function') || call.descendantsOfType('identifier')[0];
    if (functionNameNode) {
      const fnName = functionNameNode.text;
      const fqn = scopeMap.has(fnName) ? scopeMap.get(fnName) : `${baseName}::${fnName}`;
      skeleton.push(JSON.stringify({ type: 'call', name: fqn }));
    }
  }

  const tempFileName = `ast-skeleton-${crypto.randomBytes(8).toString('hex')}.jsonl`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);

  await fs.writeFile(tempFilePath, skeleton.join('\n') + '\n', 'utf-8');

  return { status: 'done', file: tempFilePath };
}
