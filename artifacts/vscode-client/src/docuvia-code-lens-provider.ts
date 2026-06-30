import * as path from "path";
import * as vscode from "vscode";
import { minimatch } from "minimatch";
import { KnowledgeStore } from "./knowledge-store.js";
import { L2Module } from "./types.js";

export interface CodeLensDecisionData {
  moduleId: string;
  moduleName: string;
  decisionIds: string[];
}

const DECLARATION_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/,
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/,
  ],
  javascript: [/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/, /^\s*(?:export\s+)?class\s+\w+/],
  typescriptreact: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/,
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/,
  ],
  javascriptreact: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/,
    /^\s*(?:export\s+)?class\s+\w+/,
  ],
  python: [/^\s*(?:async\s+)?def\s+\w+/, /^\s*class\s+\w+/],
};

function normalizeSourcePath(sourcePath: string): string {
  let normalized = sourcePath.replace(/^\.\//, "");
  if (!path.extname(normalized) && !normalized.endsWith("/")) {
    normalized += "/";
  }
  return normalized;
}

function findMatchingModules(
  documentFsPath: string,
  workspaceRoot: string,
  modules: L2Module[]
): L2Module[] {
  const relPath = path.relative(workspaceRoot, documentFsPath).split(path.sep).join("/");
  return modules.filter((module) =>
    module.source_paths.some((sp) => {
      const normalized = normalizeSourcePath(sp);
      return relPath === normalized || relPath.startsWith(normalized);
    })
  );
}

function findDeclarationLines(document: vscode.TextDocument): number[] {
  const patterns = DECLARATION_PATTERNS[document.languageId] ?? [];
  if (patterns.length === 0) return [];

  const lines: number[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (patterns.some((p) => p.test(text))) {
      lines.push(i);
    }
  }
  return lines;
}

export class DocuviaCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _store: KnowledgeStore;
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  // Max's Rule: Cache semantic anchors mapped to document symbols
  private documentAnchors = new Map<string, { line: number; name: string }[]>();

  constructor(store: KnowledgeStore, context: vscode.ExtensionContext) {
    this._store = store;
    store.onDidLoad(
      () => {
        this.documentAnchors.clear();
        this._onDidChangeCodeLenses.fire();
      },
      null,
      context.subscriptions
    );

    // Only update anchors async on save to prevent Editor Host freezing
    vscode.workspace.onDidSaveTextDocument(
      async (doc) => {
        if (this._store.getSnapshotFor(doc.uri)) {
          await this.updateSymbolAnchors(doc);
        }
      },
      null,
      context.subscriptions
    );
  }

  private async updateSymbolAnchors(document: vscode.TextDocument) {
    try {
      // Defer to LSP for actual semantic parsing
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri
      );

      if (!symbols) return;

      const anchors: { line: number; name: string }[] = [];
      const extractLines = (syms: vscode.DocumentSymbol[]) => {
        for (const sym of syms) {
          if (
            sym.kind === vscode.SymbolKind.Function ||
            sym.kind === vscode.SymbolKind.Class ||
            sym.kind === vscode.SymbolKind.Method
          ) {
            anchors.push({ line: sym.range.start.line, name: sym.name });
          }
          if (sym.children) {
            extractLines(sym.children);
          }
        }
      };

      extractLines(symbols);
      this.documentAnchors.set(document.uri.toString(), anchors);
      this._onDidChangeCodeLenses.fire();
    } catch (e) {
      console.warn("Failed to execute document symbol provider", e);
    }
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return [];

    const snapshot = this._store.getSnapshotFor(document.uri);
    if (!snapshot) return [];

    const workspaceRoot = folder.uri.fsPath;

    // Use LSP cached lines if available, fallback to fast regex ONLY on initial load
    let anchors = this.documentAnchors.get(document.uri.toString());
    if (!anchors) {
      const declarationLines = findDeclarationLines(document);
      anchors = declarationLines.map((line) => {
        const wordRange = document.getWordRangeAtPosition(new vscode.Position(line, 0));
        const name = wordRange ? document.getText(wordRange) : "unknown";
        return { line, name };
      });
      // Trigger async anchor update for next time
      setTimeout(() => this.updateSymbolAnchors(document), 0);
    }

    if (anchors.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];

    // Dynamically import QueryService here to avoid static dependency cycles or use existing instance
    const { QueryService } = await import("@workspace/core");
    const queryService = new QueryService(workspaceRoot);

    for (const anchor of anchors) {
      const range = new vscode.Range(anchor.line, 0, anchor.line, 0);
      try {
        const [impact, context] = await Promise.all([
          queryService.getImpact(anchor.name),
          queryService.getContext(anchor.name),
        ]);
        if (impact && impact.blastRadius) {
          lenses.push(
            new vscode.CodeLens(range, {
              title: `💥 Blast Radius: ${impact.blastRadius.length} nodes`,
              command: "",
              arguments: [],
            })
          );
        }
        if (context) {
          const incomingCount = context.incoming?.length || 0;
          const outgoingCount = context.outgoing?.length || 0;
          if (incomingCount > 0 || outgoingCount > 0) {
            lenses.push(
              new vscode.CodeLens(range, {
                title: `⬇️ In: ${incomingCount} | ⬆️ Out: ${outgoingCount}`,
                command: "",
                arguments: [],
              })
            );
          }
        }
      } catch (e) {
        // Ignore errors if local db isn't there
      }
    }

    // Original Module Decisions logic
    const matchedModules = findMatchingModules(
      document.uri.fsPath,
      workspaceRoot,
      snapshot.modules
    );

    if (matchedModules.length > 0) {
      const moduleData: CodeLensDecisionData[] = matchedModules
        .map((module) => {
          const decisionIds = snapshot.routerIndex
            .filter((r) => r.l2_module_id === module.id)
            .map((r) => r.id);
          return { moduleId: module.id, moduleName: module.name, decisionIds };
        })
        .filter((d) => d.decisionIds.length > 0);

      if (moduleData.length > 0) {
        const bestModule = [...moduleData].sort(
          (a, b) => b.decisionIds.length - a.decisionIds.length
        )[0];
        const count = bestModule.decisionIds.length;
        for (const anchor of anchors) {
          const range = new vscode.Range(anchor.line, 0, anchor.line, 0);
          lenses.push(
            new vscode.CodeLens(range, {
              title: `🧠 Docuvia: ${count} ${count === 1 ? "Decision" : "Decisions"}`,
              command: "docuvia.showDecisionsForLens",
              arguments: [bestModule],
            })
          );
        }
        return lenses;
      }
    }

    // Offline fallback: we matched modules but they have no decisions locally
    if (matchedModules.length > 0) {
      const offlineModule = matchedModules[0];
      for (const anchor of anchors) {
        const range = new vscode.Range(anchor.line, 0, anchor.line, 0);
        lenses.push(
          new vscode.CodeLens(range, {
            title: `🧠 Docuvia: ${offlineModule.name} — connect to server for decisions`,
            command: "",
            arguments: [],
          })
        );
      }
    }

    return lenses;
  }

  resolveCodeLens(lens: vscode.CodeLens): vscode.CodeLens {
    return lens;
  }
}
