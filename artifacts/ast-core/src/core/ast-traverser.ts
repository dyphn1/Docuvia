import { Node } from "web-tree-sitter";
import { LanguageProvider } from "../language-provider.js";
import { AstEvent } from "../sink.js";

export class AstTraverser {
  constructor(
    private provider: LanguageProvider,
    private rootNode: Node
  ) {}

  extractClasses(): AstEvent[] {
    const events: AstEvent[] = [];
    const classDecls = this.provider.extractClasses(this.rootNode);
    for (const cls of classDecls) {
      const nameNode = cls.childForFieldName("name") || cls.descendantsOfType("identifier")[0];
      if (nameNode) {
        events.push({ type: "class", name: nameNode.text });
      }
    }
    return events;
  }

  extractFunctions(): AstEvent[] {
    const events: AstEvent[] = [];
    const functionDecls = this.provider.extractFunctions(this.rootNode);
    for (const fn of functionDecls) {
      const nameNode = fn.childForFieldName("name") || fn.descendantsOfType("identifier")[0];
      if (nameNode) {
        events.push({ type: "function", name: nameNode.text });
      }
    }
    return events;
  }

  getImports(): Node[] {
    return this.provider.extractImports(this.rootNode);
  }

  getCalls(): Node[] {
    return this.provider.extractCalls(this.rootNode);
  }
}
