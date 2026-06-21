import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'smol-toml';
import { LanguageProvider, LanguageConfig, DefaultProvider } from './language-provider.js';

export interface LanguageRegistryData {
  languages: Record<string, LanguageConfig>;
}

const DEFAULT_REGISTRY: LanguageRegistryData = {
  languages: {
    typescript: {
      extensions: ['.ts', '.tsx'],
      wasm_file: 'tree-sitter-typescript.wasm',
      imports: ['import_statement'],
      classes: ['class_declaration'],
      functions: ['function_declaration', 'method_definition'],
      calls: ['call_expression'],
    },
    javascript: {
      extensions: ['.js', '.jsx'],
      wasm_file: 'tree-sitter-javascript.wasm',
      imports: ['import_statement'],
      classes: ['class_declaration'],
      functions: ['function_declaration', 'method_definition'],
      calls: ['call_expression'],
    },
    python: {
      extensions: ['.py'],
      wasm_file: 'tree-sitter-python.wasm',
      imports: ['import_statement', 'import_from_statement'],
      classes: ['class_definition'],
      functions: ['function_definition'],
      calls: ['call'],
    },
    rust: {
      extensions: ['.rs'],
      wasm_file: 'tree-sitter-rust.wasm',
      imports: ['use_declaration'],
      classes: ['struct_item', 'enum_item', 'union_item', 'trait_item'],
      functions: ['function_item'],
      calls: ['call_expression'],
    },
    go: {
      extensions: ['.go'],
      wasm_file: 'tree-sitter-go.wasm',
      imports: ['import_declaration'],
      classes: ['type_declaration'],
      functions: ['function_declaration', 'method_declaration'],
      calls: ['call_expression'],
    },
    java: {
      extensions: ['.java'],
      wasm_file: 'tree-sitter-java.wasm',
      imports: ['import_declaration'],
      classes: [
        'class_declaration',
        'interface_declaration',
        'enum_declaration',
        'annotation_type_declaration',
        'record_declaration',
      ],
      functions: ['method_declaration', 'constructor_declaration', 'compact_constructor_declaration'],
      calls: ['method_invocation', 'explicit_constructor_invocation'],
    },
    c: {
      extensions: ['.c', '.h'],
      wasm_file: 'tree-sitter-c.wasm',
      imports: ['preproc_include'],
      classes: ['struct_specifier', 'enum_specifier', 'union_specifier', 'type_definition'],
      functions: ['function_definition'],
      calls: ['call_expression'],
    },
    cpp: {
      extensions: ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.hh'],
      wasm_file: 'tree-sitter-cpp.wasm',
      imports: ['preproc_include', 'using_declaration'],
      classes: [
        'class_specifier',
        'struct_specifier',
        'enum_specifier',
        'union_specifier',
        'type_definition',
      ],
      functions: ['function_definition'],
      calls: ['call_expression'],
    },
    ruby: {
      extensions: ['.rb', '.rake', '.gemspec'],
      wasm_file: 'tree-sitter-ruby.wasm',
      imports: ['call'], // Ruby has no import statements; require/load are method calls
      classes: ['class', 'module', 'singleton_class'],
      functions: ['method', 'singleton_method'],
      calls: ['call', 'command_call'],
    },
  },
};

export class LanguageRegistry {
  private config: LanguageRegistryData;
  private extToProviderMap: Map<string, LanguageProvider>;

  private constructor(config: LanguageRegistryData) {
    this.config = config;
    this.extToProviderMap = new Map();
    this.buildCache();
  }

  private buildCache() {
    this.extToProviderMap.clear();
    for (const [_, langConfig] of Object.entries(this.config.languages)) {
      const provider = new DefaultProvider(langConfig);
      for (const ext of langConfig.extensions) {
        this.extToProviderMap.set(ext, provider);
      }
    }
  }

  public static async load(projectRoot?: string): Promise<LanguageRegistry> {
    const rootPath = projectRoot || process.cwd();
    const tomlPath = path.join(rootPath, '.docuvia', 'languages.toml');

    try {
      const content = await fs.readFile(tomlPath, 'utf-8');
      const parsed = parse(content) as unknown as LanguageRegistryData;
      
      // Basic validation
      if (parsed && typeof parsed === 'object' && parsed.languages) {
        // Merge with defaults or override completely? The requirement says "fallback to defaults".
        // Let's use parsed languages overriding defaults.
        const mergedLanguages = { ...DEFAULT_REGISTRY.languages, ...parsed.languages };
        return new LanguageRegistry({ languages: mergedLanguages });
      }
    } catch (err: any) {
      // If file doesn't exist or is invalid, just use defaults
      if (err.code !== 'ENOENT') {
        console.warn(`Failed to parse ${tomlPath}:`, err.message);
      }
    }

    return new LanguageRegistry(DEFAULT_REGISTRY);
  }

  public getProviderForExtension(ext: string): LanguageProvider | undefined {
    return this.extToProviderMap.get(ext);
  }
}

