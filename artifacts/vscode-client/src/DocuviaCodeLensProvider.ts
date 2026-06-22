import * as path from "path";
import * as vscode from "vscode";
import { minimatch } from "minimatch";
import { KnowledgeStore } from "./KnowledgeStore.js";
import { L2Module, ManifestModule } from "./types.js";

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

function findMatchingManifestModules(
  documentFsPath: string,
  workspaceRoot: string,
  manifestModules: ManifestModule[]
): ManifestModule[] {
  const relPath = path.relative(workspaceRoot, documentFsPath).split(path.sep).join("/");
  return manifestModules.filter((m) =>
    m.path_patterns.some((pattern) => minimatch(relPath, pattern, { matchBase: true }))
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
  private documentAnchors = new Map<string, number[]>();

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

      const lines: number[] = [];
      const extractLines = (syms: vscode.DocumentSymbol[]) => {
        for (const sym of syms) {
          if (
            sym.kind === vscode.SymbolKind.Function ||
            sym.kind === vscode.SymbolKind.Class ||
            sym.kind === vscode.SymbolKind.Method
          ) {
            lines.push(sym.range.start.line);
          }
          if (sym.children) {
            extractLines(sym.children);
          }
        }
      };

      extractLines(symbols);
      this.documentAnchors.set(document.uri.toString(), lines);
      this._onDidChangeCodeLenses.fire();
    } catch (e) {
      console.warn("Failed to execute document symbol provider", e);
    }
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return [];

    const snapshot = this._store.getSnapshotFor(document.uri);
    if (!snapshot) return [];

    const workspaceRoot = folder.uri.fsPath;

    // Use LSP cached lines if available, fallback to fast regex ONLY on initial load
    let declarationLines = this.documentAnchors.get(document.uri.toString());
    if (!declarationLines) {
      declarationLines = findDeclarationLines(document);
      // Trigger async anchor update for next time
      setTimeout(() => this.updateSymbolAnchors(document), 0);
    }

    if (declarationLines.length === 0) return [];

    // Online mode: full CodeLens with L3 decisions
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
        return declarationLines.map((lineIndex) => {
          const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
          return new vscode.CodeLens(range, {
            title: `🧠 Docuvia: ${count} ${count === 1 ? "Decision" : "Decisions"}`,
            command: "docuvia.showDecisionsForLens",
            arguments: [bestModule],
          });
        });
      }
    }

    // Offline fallback: use manifest path patterns when server modules have no source_paths
    const matchedManifest = findMatchingManifestModules(
      document.uri.fsPath,
      workspaceRoot,
      snapshot.manifestModules
    );
    if (matchedManifest.length === 0) return [];

    const offlineModule = matchedManifest[0];
    return declarationLines.map((lineIndex) => {
      const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
      return new vscode.CodeLens(range, {
        title: `🧠 Docuvia: ${offlineModule.name} — connect to server for decisions`,
        command: "",
        arguments: [],
      });
    });
  }

  resolveCodeLens(lens: vscode.CodeLens): vscode.CodeLens {
    return lens;
  }
}
