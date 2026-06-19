import type { Node } from 'web-tree-sitter';

export interface LanguageProvider {
  wasm_file: string;
  extractClasses: (rootNode: Node) => Node[];
  extractFunctions: (rootNode: Node) => Node[];
  extractImports: (rootNode: Node) => Node[];
  extractCalls: (rootNode: Node) => Node[];
}

export interface LanguageConfig {
  extensions: string[];
  wasm_file: string;
  imports: string[];
  classes: string[];
  functions: string[];
  calls: string[];
}

export class DefaultProvider implements LanguageProvider {
  wasm_file: string;
  private config: LanguageConfig;

  constructor(config: LanguageConfig) {
    this.config = config;
    this.wasm_file = config.wasm_file;
  }

  extractClasses(rootNode: Node): Node[] {
    const nodes: Node[] = [];
    for (const classType of this.config.classes) {
      nodes.push(...rootNode.descendantsOfType(classType));
    }
    return nodes;
  }

  extractFunctions(rootNode: Node): Node[] {
    const nodes: Node[] = [];
    for (const funcType of this.config.functions) {
      nodes.push(...rootNode.descendantsOfType(funcType));
    }
    return nodes;
  }

  extractImports(rootNode: Node): Node[] {
    const nodes: Node[] = [];
    for (const importType of this.config.imports) {
      nodes.push(...rootNode.descendantsOfType(importType));
    }
    return nodes;
  }

  extractCalls(rootNode: Node): Node[] {
    const nodes: Node[] = [];
    for (const callType of this.config.calls) {
      nodes.push(...rootNode.descendantsOfType(callType));
    }
    return nodes;
  }
}
