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

