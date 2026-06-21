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
      queries: {
        classes: `(class_declaration name: (identifier) @class)`,
        functions: `(function_declaration name: (identifier) @function) (method_definition name: (property_identifier) @function)`,
        imports: `(import_statement) @import`,
        calls: `(call_expression function: [(identifier) (member_expression)] @call)`,
      },
    },
    javascript: {
      extensions: ['.js', '.jsx'],
      wasm_file: 'tree-sitter-javascript.wasm',
      imports: ['import_statement'],
      classes: ['class_declaration'],
      functions: ['function_declaration', 'method_definition'],
      calls: ['call_expression'],
      queries: {
        classes: `(class_declaration name: (identifier) @class)`,
        functions: `(function_declaration name: (identifier) @function) (method_definition name: (property_identifier) @function)`,
        imports: `(import_statement) @import`,
        calls: `(call_expression function: [(identifier) (member_expression)] @call)`,
      },
    },
    python: {
      extensions: ['.py'],
      wasm_file: 'tree-sitter-python.wasm',
      imports: ['import_statement', 'import_from_statement'],
      classes: ['class_definition'],
      functions: ['function_definition'],
      calls: ['call'],
      queries: {
        classes: `(class_definition name: (identifier) @class)`,
        functions: `(function_definition name: (identifier) @function)`,
        imports: `(import_statement) @import (import_from_statement) @import`,
        calls: `(call function: [(identifier) (attribute)] @call)`,
      },
    },
    rust: {
      extensions: ['.rs'],
      wasm_file: 'tree-sitter-rust.wasm',
      imports: ['use_declaration'],
      classes: ['struct_item', 'enum_item', 'union_item', 'trait_item'],
      functions: ['function_item'],
      calls: ['call_expression'],
      queries: {
        classes: `(struct_item name: (type_identifier) @class) (enum_item name: (type_identifier) @class) (union_item name: (type_identifier) @class) (trait_item name: (type_identifier) @class)`,
        functions: `(function_item name: (identifier) @function)`,
        imports: `(use_declaration) @import`,
        calls: `(call_expression function: [(identifier) (field_expression)] @call)`,
      },
    },
    go: {
      extensions: ['.go'],
      wasm_file: 'tree-sitter-go.wasm',
      imports: ['import_declaration'],
      classes: ['type_declaration'],
      functions: ['function_declaration', 'method_declaration'],
      calls: ['call_expression'],
      queries: {
        classes: `(type_declaration name: (type_identifier) @class)`,
        functions: `(function_declaration name: (identifier) @function) (method_declaration name: (field_identifier) @function)`,
        imports: `(import_declaration) @import`,
        calls: `(call_expression function: [(identifier) (selector_expression)] @call)`,
      },
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
      queries: {
        classes: `(class_declaration name: (identifier) @class) (interface_declaration name: (identifier) @class) (enum_declaration name: (identifier) @class) (annotation_type_declaration name: (identifier) @class) (record_declaration name: (identifier) @class)`,
        functions: `(method_declaration name: (identifier) @function) (constructor_declaration name: (identifier) @function) (compact_constructor_declaration name: (identifier) @function)`,
        imports: `(import_declaration) @import`,
        calls: `(method_invocation name: (identifier) @call) (explicit_constructor_invocation) @call`,
      },
    },
    c: {
      extensions: ['.c', '.h'],
      wasm_file: 'tree-sitter-c.wasm',
      imports: ['preproc_include'],
      classes: ['struct_specifier', 'enum_specifier', 'union_specifier', 'type_definition'],
      functions: ['function_definition'],
      calls: ['call_expression'],
      queries: {
        classes: `(struct_specifier name: (type_identifier) @class) (enum_specifier name: (type_identifier) @class) (union_specifier name: (type_identifier) @class) (type_definition name: (type_identifier) @class)`,
        functions: `(function_definition declarator: (function_declarator declarator: (identifier) @function))`,
        imports: `(preproc_include) @import`,
        calls: `(call_expression function: (identifier) @call)`,
      },
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
      queries: {
        classes: `(class_specifier name: (type_identifier) @class) (struct_specifier name: (type_identifier) @class) (enum_specifier name: (type_identifier) @class) (union_specifier name: (type_identifier) @class) (type_definition name: (type_identifier) @class)`,
        functions: `(function_definition declarator: (function_declarator declarator: (identifier) @function))`,
        imports: `(preproc_include) @import (using_declaration) @import`,
        calls: `(call_expression function: [(identifier) (field_expression)] @call)`,
      },
    },
    ruby: {
      extensions: ['.rb', '.rake', '.gemspec'],
      wasm_file: 'tree-sitter-ruby.wasm',
      imports: ['call'], // Ruby has no import statements; require/load are method calls
      classes: ['class', 'module', 'singleton_class'],
      functions: ['method', 'singleton_method'],
      calls: ['call', 'command_call'],
      queries: {
        classes: `(class name: [(constant) (scope)] @class) (module name: (constant) @class) (singleton_class) @class`,
        functions: `(method name: (identifier) @function) (singleton_method name: (identifier) @function)`,
        imports: `(call method: (identifier) @_method @_method.match?(/^(require|require_relative|load)$/) @import)`,
        calls: `(call method: (identifier) @call) (command_call method: (identifier) @call)`,
      },
    },
    php: {
      extensions: ['.php', '.phtml', '.php3', '.php4', '.php5', '.phps'],
      wasm_file: 'tree-sitter-php.wasm',
      imports: [
        'namespace_use_declaration',
        'include_expression',
        'include_once_expression',
        'require_expression',
        'require_once_expression',
      ],
      classes: [
        'class_declaration',
        'interface_declaration',
        'trait_declaration',
        'enum_declaration',
      ],
      functions: ['function_definition', 'method_declaration'],
      calls: [
        'function_call_expression',
        'member_call_expression',
        'scoped_call_expression',
      ],
      queries: {
        classes: `(class_declaration name: (name) @class) (interface_declaration name: (name) @class) (trait_declaration name: (name) @class) (enum_declaration name: (name) @class)`,
        functions: `(function_definition name: (name) @function) (method_declaration name: (name) @function)`,
        imports: `(namespace_use_declaration) @import (include_expression) @import (include_once_expression) @import (require_expression) @import (require_once_expression) @import`,
        calls: `(function_call_expression function: (name) @call) (member_call_expression name: (name) @call) (scoped_call_expression name: (name) @call)`,
      },
    },
    csharp: {
      extensions: ['.cs'],
      wasm_file: 'tree-sitter-c_sharp.wasm',
      imports: ['using_directive'],
      classes: [
        'class_declaration',
        'struct_declaration',
        'interface_declaration',
        'enum_declaration',
        'record_declaration',
      ],
      functions: [
        'method_declaration',
        'constructor_declaration',
        'destructor_declaration',
        'conversion_operator_declaration',
        'operator_declaration',
        'local_function_statement',
      ],
      calls: [
        'invocation_expression',
        'object_creation_expression',
      ],
      queries: {
        classes: `(class_declaration name: (identifier) @class) (struct_declaration name: (identifier) @class) (interface_declaration name: (identifier) @class) (enum_declaration name: (identifier) @class) (record_declaration name: (identifier) @class)`,
        functions: `(method_declaration name: (identifier) @function) (constructor_declaration name: (identifier) @function) (destructor_declaration) @function (conversion_operator_declaration) @function (operator_declaration) @function (local_function_statement) @function`,
        imports: `(using_directive) @import`,
        calls: `(invocation_expression) @call (object_creation_expression) @call`,
      },
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

