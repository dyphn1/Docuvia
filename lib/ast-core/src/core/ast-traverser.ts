import { Node } from "web-tree-sitter";
import { LanguageProvider } from "../language-provider.js";
import { AstEvent } from "../sink.js";
import { AstEventType } from "../constants/ast-event-constants.js";

export class AstTraverser {
  constructor(
    private provider: LanguageProvider,
    private rootNode: Node,
  ) {}

  private getDeclName(node: Node): string | undefined {
    const nameNode =
      node.childForFieldName("name") || node.descendantsOfType("identifier")[0];
    return nameNode?.text;
  }

  private extractNamed(
    nodes: Node[],
    type: typeof AstEventType.CLASS | typeof AstEventType.FUNCTION,
  ): AstEvent[] {
    const events: AstEvent[] = [];
    for (const node of nodes) {
      const name = this.getDeclName(node);
      if (name) events.push({ type, name });
    }
    return events;
  }

  extractClasses(): AstEvent[] {
    return this.extractNamed(
      this.provider.extractClasses(this.rootNode),
      AstEventType.CLASS,
    );
  }

  extractFunctions(): AstEvent[] {
    return this.extractNamed(
      this.provider.extractFunctions(this.rootNode),
      AstEventType.FUNCTION,
    );
  }

  getImports(): Node[] {
    return this.provider.extractImports(this.rootNode);
  }

  getCalls(): Node[] {
    return this.provider.extractCalls(this.rootNode);
  }
}
