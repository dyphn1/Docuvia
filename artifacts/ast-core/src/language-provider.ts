import type { Language, Node, QueryCapture } from "web-tree-sitter";
import { Query } from "web-tree-sitter";

export interface LanguageProvider {
  wasm_file: string;
  extractClasses: (rootNode: Node) => Node[];
  extractFunctions: (rootNode: Node) => Node[];
  extractImports: (rootNode: Node) => Node[];
  extractCalls: (rootNode: Node) => Node[];
  deleteQueries?: () => void;
}

export interface LanguageQueryConfig {
  classes: string;
  functions: string;
  imports: string;
  calls: string;
}

export interface LanguageConfig {
  extensions: string[];
  wasm_file: string;
  imports: string[];
  classes: string[];
  functions: string[];
  calls: string[];
  queries?: LanguageQueryConfig;
}

type CompiledQueries = {
  classes?: Query;
  functions?: Query;
  imports?: Query;
  calls?: Query;
};

export class DefaultProvider implements LanguageProvider {
  wasm_file: string;
  private config: LanguageConfig;
  private compiledQueries: CompiledQueries | null = null;

  constructor(config: LanguageConfig) {
    this.config = config;
    this.wasm_file = config.wasm_file;
  }

  initQueries(language: Language): void {
    if (this.compiledQueries || !this.config.queries) return;
    const q = this.config.queries;
    this.compiledQueries = {
      classes: q.classes ? new Query(language, q.classes) : undefined,
      functions: q.functions ? new Query(language, q.functions) : undefined,
      imports: q.imports ? new Query(language, q.imports) : undefined,
      calls: q.calls ? new Query(language, q.calls) : undefined,
    };
  }

  deleteQueries(): void {
    if (!this.compiledQueries) return;
    this.compiledQueries.classes?.delete();
    this.compiledQueries.functions?.delete();
    this.compiledQueries.imports?.delete();
    this.compiledQueries.calls?.delete();
    this.compiledQueries = null;
  }

  private captureNodes(rootNode: Node, captureNames: string[], query?: Query): Node[] {
    if (!query) return [];
    const captures: QueryCapture[] = query.captures(rootNode);
    const nodes: Node[] = [];
    for (const c of captures) {
      if (captureNames.length === 0 || captureNames.includes(c.name)) {
        nodes.push(c.node);
      }
    }
    return nodes;
  }

  extractClasses(rootNode: Node): Node[] {
    return this.extractNodes(rootNode, this.compiledQueries?.classes, ["class"], this.config.classes);
  }

  extractFunctions(rootNode: Node): Node[] {
    return this.extractNodes(rootNode, this.compiledQueries?.functions, ["function"], this.config.functions);
  }

  extractImports(rootNode: Node): Node[] {
    return this.extractNodes(rootNode, this.compiledQueries?.imports, ["import"], this.config.imports);
  }

  extractCalls(rootNode: Node): Node[] {
    return this.extractNodes(rootNode, this.compiledQueries?.calls, ["call"], this.config.calls);
  }

  private extractNodes(rootNode: Node, query: Query | undefined, captureNames: string[], fallbackTypes: string[]): Node[] {
    if (query) {
      return this.captureNodes(rootNode, captureNames, query);
    }
    const nodes: Node[] = [];
    for (const nodeType of fallbackTypes) {
      nodes.push(...rootNode.descendantsOfType(nodeType));
    }
    return nodes;
  }
}
