import { Parser, Language, Tree, Node } from "web-tree-sitter";

export enum PruningLevel {
  INTERNAL_LOGIC = 0, // Level 0: Blast Radius = 0
  CONTRACT_CHANGED = 1, // Level 1: Trigger Diffusion
}

export interface LineRange {
  startRow: number;
  endRow: number;
}

export interface ModifiedNode {
  nodeId: string;
  nodeType: string;
  pruningLevel: PruningLevel;
  newRange: LineRange;
}

const SEMANTIC_TYPES = new Set([
  "function_declaration",
  "method_definition",
  "arrow_function",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "export_statement",
  "lexical_declaration",
  "variable_declaration",
]);

export class SemanticDiffDetector {
  constructor(
    private parser: Parser,
    private lang: Language,
  ) {
    this.parser.setLanguage(this.lang);
  }

  public analyze(
    oldSource: string,
    newSource: string,
    changedLineRanges: LineRange[],
  ): ModifiedNode[] {
    const oldTree = this.parser.parse(oldSource);
    const newTree = this.parser.parse(newSource);
    if (!oldTree || !newTree) {
      if (oldTree) oldTree.delete();
      if (newTree) newTree.delete();
      return [];
    }

    const results: ModifiedNode[] = [];

    try {
      const oldNodeIndex = this.buildNodeIndex(oldTree.rootNode);
      const processedNodes = new Set<number>();

      for (const range of changedLineRanges) {
        const smallestNode = this.getSmallestContainingNode(
          newTree.rootNode,
          range,
        );
        if (!smallestNode) continue;

        const semanticBoundary = this.findSemanticBoundary(smallestNode);
        if (!semanticBoundary) continue;

        if (processedNodes.has(semanticBoundary.id)) {
          continue; // Already processed this boundary for another line range
        }
        processedNodes.add(semanticBoundary.id);

        const newName = this.getNodeName(semanticBoundary);
        const oldNode = newName
          ? oldNodeIndex.get(`${semanticBoundary.type}::${newName}`)
          : undefined;

        let pruningLevel = PruningLevel.CONTRACT_CHANGED;

        if (oldNode) {
          const oldSig = this.getSignature(oldNode);
          const newSig = this.getSignature(semanticBoundary);

          if (oldSig === newSig) {
            pruningLevel = PruningLevel.INTERNAL_LOGIC;
          }
        }

        results.push({
          nodeId: newName || semanticBoundary.id.toString(),
          nodeType: semanticBoundary.type,
          pruningLevel,
          newRange: {
            startRow: semanticBoundary.startPosition.row,
            endRow: semanticBoundary.endPosition.row,
          },
        });
      }
    } finally {
      if (oldTree) oldTree.delete();
      if (newTree) newTree.delete();
    }

    return results;
  }

  /**
   * Indexes old-tree nodes by `${type}::${name}` so matching a changed
   * boundary against the old tree is an O(1) lookup instead of a full
   * tree search per changed range. Only semantic-boundary types are
   * indexed since that's the only kind of node ever looked up.
   */
  private buildNodeIndex(root: Node): Map<string, Node> {
    const index = new Map<string, Node>();

    const visit = (n: Node) => {
      if (SEMANTIC_TYPES.has(n.type)) {
        const name = this.getNodeName(n);
        const key = name ? `${n.type}::${name}` : null;
        if (key && !index.has(key)) {
          index.set(key, n);
        }
      }
      for (const child of n.children) {
        if (child) visit(child);
      }
    };

    visit(root);
    return index;
  }

  private getSmallestContainingNode(node: Node, range: LineRange): Node | null {
    if (
      node.startPosition.row > range.endRow ||
      node.endPosition.row < range.startRow
    ) {
      return null;
    }

    if (
      node.startPosition.row <= range.startRow &&
      node.endPosition.row >= range.endRow
    ) {
      for (const child of node.children) {
        if (!child) continue;
        const childResult = this.getSmallestContainingNode(child, range);
        if (childResult) return childResult;
      }
      return node;
    }

    return null;
  }

  private findSemanticBoundary(node: Node): Node | null {
    let current: Node | null = node;
    while (current) {
      if (SEMANTIC_TYPES.has(current.type)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  private getNodeName(node: Node): string | null {
    const nameNode = node.childForFieldName("name");
    if (nameNode) return nameNode.text;

    // Handle variable declarations: variable_declaration -> variable_declarator -> name
    if (
      node.type === "variable_declaration" ||
      node.type === "lexical_declaration"
    ) {
      const decl = node.children.find(
        (c: Node) => c.type === "variable_declarator",
      );
      if (decl) {
        const declName = decl.childForFieldName("name");
        if (declName) return declName.text;
      }
    }
    return null;
  }

  private getSignature(node: Node): string {
    const body =
      node.childForFieldName("body") || node.childForFieldName("value");

    // For variable_declarator, body could be the arrow function body or object value
    // In tree-sitter TS: variable_declarator has 'name' and 'value'
    // If it's a function declaration, it has 'body'

    // To be safe and generic, we just exclude the child that represents the block or the value
    // if the value is an arrow function, its body is 'body'.

    // If the node is a variable_declaration, we want the signature to ignore the arrow function body.
    if (
      node.type === "variable_declaration" ||
      node.type === "lexical_declaration"
    ) {
      const decl = node.children.find(
        (c: Node) => c.type === "variable_declarator",
      );
      if (decl) {
        const value = decl.childForFieldName("value");
        if (value && value.type === "arrow_function") {
          const arrowBody = value.childForFieldName("body");
          if (arrowBody) {
            // Collect text of variable_declaration but omit the arrow function's body
            return this.getTextExcludingNode(node, arrowBody);
          }
        }
      }
    }

    if (body) {
      return this.getTextExcludingNode(node, body);
    }

    return node.text;
  }

  private getTextExcludingNode(root: Node, exclude: Node): string {
    const tokens: string[] = [];

    const traverse = (n: Node) => {
      if (n.id === exclude.id) return;

      // If node has no children or it's just a text token, collect its text
      if (n.childCount === 0) {
        tokens.push(n.text);
      } else {
        for (const child of n.children) {
          if (!child) continue;
          traverse(child);
        }
      }
    };

    traverse(root);
    return tokens.join(" ").trim().replace(/\s+/g, " "); // Normalize whitespace
  }
}
