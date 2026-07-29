import { Parser, Language, Tree, Node } from "web-tree-sitter";
import { TreeSitterNodeTypes } from "../constants/tree-sitter-node-types.js";

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

const SEMANTIC_TYPES = new Set<string>([
  TreeSitterNodeTypes.FUNCTION_DECLARATION,
  TreeSitterNodeTypes.METHOD_DEFINITION,
  TreeSitterNodeTypes.ARROW_FUNCTION,
  TreeSitterNodeTypes.CLASS_DECLARATION,
  TreeSitterNodeTypes.INTERFACE_DECLARATION,
  TreeSitterNodeTypes.TYPE_ALIAS_DECLARATION,
  TreeSitterNodeTypes.EXPORT_STATEMENT,
  TreeSitterNodeTypes.LEXICAL_DECLARATION,
  TreeSitterNodeTypes.VARIABLE_DECLARATION,
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
        results.push(
          ...this.processChangedRange(
            range,
            newTree.rootNode,
            oldNodeIndex,
            processedNodes,
          ),
        );
      }
    } finally {
      if (oldTree) oldTree.delete();
      if (newTree) newTree.delete();
    }

    return results;
  }

  /**
   * Resolves a single changed line range against the new tree's smallest containing
   * semantic boundary and builds the corresponding {@link ModifiedNode}(s), deduped against
   * already-processed boundaries. Normally yields at most one result. Falls back to
   * {@link resolveSpanningBoundaries} (zero or more results) when the range straddles multiple
   * top-level siblings with no common semantic ancestor -- e.g. a new function's own leading
   * blank line/doc comment plus its declaration, which `getSmallestContainingNode` can only
   * match by bubbling all the way up to the un-typed tree root, where `findSemanticBoundary`
   * dead-ends. Without this fallback such a range is silently dropped: `contractChanged` would
   * come back `false` for essentially any documented new symbol (2026-07-29 finding).
   */
  private processChangedRange(
    range: LineRange,
    newRoot: Node,
    oldNodeIndex: Map<string, Node>,
    processedNodes: Set<number>,
  ): ModifiedNode[] {
    const smallestNode = this.getSmallestContainingNode(newRoot, range);
    if (!smallestNode) return [];

    const semanticBoundary = this.findSemanticBoundary(smallestNode);
    if (!semanticBoundary) {
      return this.resolveSpanningBoundaries(
        smallestNode,
        range,
        oldNodeIndex,
        processedNodes,
      );
    }

    const built = this.buildModifiedNode(
      semanticBoundary,
      oldNodeIndex,
      processedNodes,
    );
    return built ? [built] : [];
  }

  /**
   * The straddling-siblings fallback (see {@link processChangedRange}'s doc comment): re-matches
   * each direct child of `deadEndNode` that overlaps `range` at all (not requiring full
   * containment, unlike the primary algorithm) against a sub-range clamped to that child's own
   * span, so `getSmallestContainingNode` can resolve a real semantic boundary from within just
   * that child instead of the whole un-typed span. Deliberately does not touch the primary
   * full-containment algorithm at all: a range that stays within one semantic container (e.g. two
   * statements inside the same function body) already bubbles up to that container correctly
   * today, and must keep doing so -- only a range that reaches a dead end (no semantic ancestor
   * anywhere above `deadEndNode`, in practice the un-typed `program` root) should ever reach here.
   */
  private resolveSpanningBoundaries(
    deadEndNode: Node,
    range: LineRange,
    oldNodeIndex: Map<string, Node>,
    processedNodes: Set<number>,
  ): ModifiedNode[] {
    const results: ModifiedNode[] = [];

    for (const child of deadEndNode.children) {
      if (!child) continue;
      if (
        child.endPosition.row < range.startRow ||
        child.startPosition.row > range.endRow
      ) {
        continue; // no overlap with the changed range at all
      }

      const clampedRange: LineRange = {
        startRow: Math.max(range.startRow, child.startPosition.row),
        endRow: Math.min(range.endRow, child.endPosition.row),
      };
      const smallest = this.getSmallestContainingNode(child, clampedRange);
      if (!smallest) continue;

      const semanticBoundary = this.findSemanticBoundary(smallest);
      if (!semanticBoundary) continue; // e.g. a bare comment sibling -- nothing to report

      const built = this.buildModifiedNode(
        semanticBoundary,
        oldNodeIndex,
        processedNodes,
      );
      if (built) results.push(built);
    }

    return results;
  }

  /** Dedupes `semanticBoundary` against `processedNodes` and builds its {@link ModifiedNode},
   *  comparing old vs. new signatures via `resolvePruningLevel` -- shared by both the primary
   *  match and the {@link resolveSpanningBoundaries} fallback so a boundary is never reported
   *  twice regardless of which path found it. */
  private buildModifiedNode(
    semanticBoundary: Node,
    oldNodeIndex: Map<string, Node>,
    processedNodes: Set<number>,
  ): ModifiedNode | null {
    if (processedNodes.has(semanticBoundary.id)) {
      return null; // Already processed this boundary for another line range
    }
    processedNodes.add(semanticBoundary.id);

    const newName = this.getNodeName(semanticBoundary);
    const oldNode = newName
      ? oldNodeIndex.get(`${semanticBoundary.type}::${newName}`)
      : undefined;

    const pruningLevel = this.resolvePruningLevel(oldNode, semanticBoundary);

    return {
      nodeId: newName || semanticBoundary.id.toString(),
      nodeType: semanticBoundary.type,
      pruningLevel,
      newRange: {
        startRow: semanticBoundary.startPosition.row,
        endRow: semanticBoundary.endPosition.row,
      },
    };
  }

  /** Compares old vs. new signatures to decide whether a change is purely internal. */
  private resolvePruningLevel(
    oldNode: Node | undefined,
    semanticBoundary: Node,
  ): PruningLevel {
    if (!oldNode) return PruningLevel.CONTRACT_CHANGED;

    const oldSig = this.getSignature(oldNode);
    const newSig = this.getSignature(semanticBoundary);

    return oldSig === newSig
      ? PruningLevel.INTERNAL_LOGIC
      : PruningLevel.CONTRACT_CHANGED;
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
      node.type === TreeSitterNodeTypes.VARIABLE_DECLARATION ||
      node.type === TreeSitterNodeTypes.LEXICAL_DECLARATION
    ) {
      const decl = node.children.find(
        (c: Node) => c.type === TreeSitterNodeTypes.VARIABLE_DECLARATOR,
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
      node.type === TreeSitterNodeTypes.VARIABLE_DECLARATION ||
      node.type === TreeSitterNodeTypes.LEXICAL_DECLARATION
    ) {
      const decl = node.children.find(
        (c: Node) => c.type === TreeSitterNodeTypes.VARIABLE_DECLARATOR,
      );
      if (decl) {
        const value = decl.childForFieldName("value");
        if (value && value.type === TreeSitterNodeTypes.ARROW_FUNCTION) {
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
