import { Parser, Language } from 'web-tree-sitter';
import { createRequire } from 'node:module';
import { LanguageRegistry } from '../lib/ast/language-registry.js';
import { LanguageProvider } from '../lib/ast/language-provider.js';

const require = createRequire(import.meta.url);

async function initParser() {
  const wasmPath = path.join(path.dirname(require.resolve('web-tree-sitter')), 'web-tree-sitter.wasm');
  await Parser.init({ locateFile: () => wasmPath });
}

async function loadLanguage(ext: string, registry: LanguageRegistry) {
  const provider = registry.getProviderForExtension(ext);
  if (!provider) {
    throw new Error(`No provider for extension ${ext}`);
  }
  const wasmFileName = provider.wasm_file;
  // Try to load from current working directory, then fallback to individual package
  let wasmPath = path.resolve(process.cwd(), wasmFileName);
  try {
    await fs.access(wasmPath);
  } catch {
    try {
      const pkgName = wasmFileName.replace('.wasm', '');
      const langPkgPath = require.resolve(`${pkgName}/package.json`);
      wasmPath = path.join(path.dirname(langPkgPath), wasmFileName);
    } catch {
      // Let Language.load throw if not found
    }
  }
  const lang = await Language.load(wasmPath);
  return { lang, provider };
}

const fs = await import('node:fs/promises');
const path = await import('node:path');

async function main() {
  await initParser();
  const registry = await LanguageRegistry.load();
  
  const ext = '.rs';
  const { lang, provider } = await loadLanguage(ext, registry);
  
  const parser = new Parser();
  parser.setLanguage(lang!);
  
  // Sample Rust code
  const rustCode = `
    use std::collections::HashMap;
    
    struct Point {
        x: i32,
        y: i32,
    }
    
    enum Result<T, E> {
        Ok(T),
        Err(E),
    }
    
    trait Drawable {
        fn draw(&self);
    }
    
    impl Drawable for Point {
        fn draw(&self) {
            println!("Drawing point at ({}, {})", self.x, self.y);
        }
    }
    
    fn main() {
        let p = Point { x: 10, y: 20 };
        p.draw();
        let mut map = HashMap::new();
        map.insert("key", "value");
    }
  `;
  
  const tree = parser.parse(rustCode);
  if (!tree) {
    console.error('Failed to parse Rust code');
    return;
  }
  
  const importNodes = provider.extractImports(tree.rootNode);
  const classNodes = provider.extractClasses(tree.rootNode);
  const functionNodes = provider.extractFunctions(tree.rootNode);
  const callNodes = provider.extractCalls(tree.rootNode);
  
  console.log('Imports:', importNodes.map(n => n.text));
  console.log('Classes:', classNodes.map(n => n.text));
  console.log('Functions:', functionNodes.map(n => n.text));
  console.log('Calls:', callNodes.map(n => n.text));
}

main().catch(console.error);