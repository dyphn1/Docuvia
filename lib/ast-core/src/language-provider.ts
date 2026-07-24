import type { Language, Node, QueryCapture } from "web-tree-sitter";
import { Query } from "web-tree-sitter";
import { AstEventType } from "./constants/ast-event-constants.js";

/** Query capture group names for relationships without an AstEvent.type counterpart. */
const QueryCaptureName = {
  IMPLEMENTS: "implements",
  EXTENDS: "extends",
} as const;

export interface LanguageProvider {
  buildScopeMap?: (importStatements: Node[]) => Map<string, string>;
  classifyCall?: (callNode: Node) => {
    isMethodCall: boolean;
    methodName: string;
    objectName?: string;
  };
  wasm_file: string;
  extractClasses: (rootNode: Node) => Node[];
  extractFunctions: (rootNode: Node) => Node[];
  extractImports: (rootNode: Node) => Node[];
  extractCalls: (rootNode: Node) => Node[];
  extractImplements?: (rootNode: Node) => Node[];
  extractExtends?: (rootNode: Node) => Node[];
  initQueries?: (language: Language) => void;
  deleteQueries?: () => void;
}

export interface LanguageQueryConfig {
  classes: string;
  // Optional: a language may omit this when some of its function-kind nodes (e.g. arrow
  // functions with no queryable "name" field) need the fuller descendantsOfType fallback
  // instead of a query that would only capture a subset — see typescript.ts/javascript.ts.
  functions?: string;
  imports: string;
  calls: string;
  implements?: string;
  extends?: string;
}

export interface LanguageConfig {
  buildScopeMap?: (importStatements: Node[]) => Map<string, string>;
  classifyCall?: (callNode: Node) => {
    isMethodCall: boolean;
    methodName: string;
    objectName?: string;
  };
  extensions: string[];
  wasm_file: string;
  imports: string[];
  classes: string[];
  functions: string[];
  calls: string[];
  implements?: string[];
  extends?: string[];
  queries?: LanguageQueryConfig;
}

type CompiledQueries = {
  classes?: Query;
  functions?: Query;
  imports?: Query;
  calls?: Query;
  implements?: Query;
  extends?: Query;
};

export class DefaultProvider implements LanguageProvider {
  buildScopeMap(importStatements: Node[]): Map<string, string> {
    if (this.config.buildScopeMap)
      return this.config.buildScopeMap(importStatements);
    return new Map<string, string>();
  }

  classifyCall(callNode: Node): {
    isMethodCall: boolean;
    methodName: string;
    objectName?: string;
  } {
    if (this.config.classifyCall) return this.config.classifyCall(callNode);
    return { isMethodCall: false, methodName: callNode.text };
  }

  wasm_file: string;
  private config: LanguageConfig;
  private compiledQueries: CompiledQueries | null = null;

  constructor(config: LanguageConfig) {
    this.config = config;
    this.wasm_file = config.wasm_file;
  }

  /**
   * Compiles each query field independently: one field's pattern failing to compile against the
   * installed grammar (a real, observed failure mode across grammar-version bumps — see IMPT-001)
   * degrades only that field to its `descendantsOfType` fallback rather than silently discarding
   * every other field's precision for the whole language.
   */
  initQueries(language: Language): void {
    if (this.compiledQueries || !this.config.queries) return;
    const q = this.config.queries;
    this.compiledQueries = {
      classes: this.compileQuery(language, q.classes),
      functions: this.compileQuery(language, q.functions),
      imports: this.compileQuery(language, q.imports),
      calls: this.compileQuery(language, q.calls),
      implements: this.compileQuery(language, q.implements),
      extends: this.compileQuery(language, q.extends),
    };
  }

  private compileQuery(
    language: Language,
    pattern: string | undefined,
  ): Query | undefined {
    if (!pattern) return undefined;
    try {
      return new Query(language, pattern);
    } catch {
      return undefined;
    }
  }

  deleteQueries(): void {
    if (!this.compiledQueries) return;
    this.compiledQueries.classes?.delete();
    this.compiledQueries.functions?.delete();
    this.compiledQueries.imports?.delete();
    this.compiledQueries.calls?.delete();
    this.compiledQueries.implements?.delete();
    this.compiledQueries.extends?.delete();
    this.compiledQueries = null;
  }

  private captureNodes(
    rootNode: Node,
    captureNames: string[],
    query?: Query,
  ): Node[] {
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
    return this.extractNodes(
      rootNode,
      this.compiledQueries?.classes,
      [AstEventType.CLASS],
      this.config.classes,
    );
  }

  extractFunctions(rootNode: Node): Node[] {
    return this.extractNodes(
      rootNode,
      this.compiledQueries?.functions,
      [AstEventType.FUNCTION],
      this.config.functions,
    );
  }

  extractImports(rootNode: Node): Node[] {
    return this.extractNodes(
      rootNode,
      this.compiledQueries?.imports,
      [AstEventType.IMPORT],
      this.config.imports,
    );
  }

  extractCalls(rootNode: Node): Node[] {
    return this.extractNodes(
      rootNode,
      this.compiledQueries?.calls,
      [AstEventType.CALL],
      this.config.calls,
    );
  }

  extractImplements(rootNode: Node): Node[] {
    return this.extractNodes(
      rootNode,
      this.compiledQueries?.implements,
      [QueryCaptureName.IMPLEMENTS],
      this.config.implements || [],
    );
  }

  extractExtends(rootNode: Node): Node[] {
    return this.extractNodes(
      rootNode,
      this.compiledQueries?.extends,
      [QueryCaptureName.EXTENDS],
      this.config.extends || [],
    );
  }

  private extractNodes(
    rootNode: Node,
    query: Query | undefined,
    captureNames: string[],
    fallbackTypes: string[],
  ): Node[] {
    if (query) {
      return this.captureNodes(rootNode, captureNames, query);
    }
    const nodes: Node[] = [];
    for (const nodeType of fallbackTypes) {
      nodes.push(
        ...(rootNode.descendantsOfType(nodeType).filter(Boolean) as Node[]),
      );
    }
    return nodes;
  }
}
