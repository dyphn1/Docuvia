import * as vscode from "vscode";
import { minimatch } from "minimatch";
import { LocalSnapshotService } from "@workspace/core";
import { L2Module } from "./types.js";

export class DocuviaCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  private documentAnchors = new Map<string, { line: number; name: string }[]>();

  constructor(context: vscode.ExtensionContext) {
    vscode.workspace.onDidSaveTextDocument(
      async (doc) => {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
        if (workspaceRoot) {
          const snapshotService = new LocalSnapshotService(workspaceRoot);
          if (snapshotService.getSnapshot()) {
            await this.updateSymbolAnchors(doc);
          }
        }
      },
      null,
      context.subscriptions
    );

    vscode.workspace.onDidOpenTextDocument(
      async (doc) => {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
        if (workspaceRoot) {
          const snapshotService = new LocalSnapshotService(workspaceRoot);
          if (snapshotService.getSnapshot()) {
            await this.updateSymbolAnchors(doc);
          }
        }
      },
      null,
      context.subscriptions
    );
  }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  public async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return [];

    const snapshotService = new LocalSnapshotService(folder.uri.fsPath);
    const snapshot = snapshotService.getSnapshot();
    if (!snapshot) return [];

    const relativePath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
    let relevantModules: L2Module[] = [];

    // Convert to L2Module type matching
    for (const mod of snapshot.modules) {
      if (!mod.source_paths) continue;
      for (const pattern of mod.source_paths) {
        if (minimatch(relativePath, pattern)) {
          relevantModules.push({
            ...mod,
            decisions: [], // We'll look up decisions from snapshot.decisions
          });
          break;
        }
      }
    }

    if (relevantModules.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];
    let lineIdx = 0;

    const anchors = this.documentAnchors.get(document.uri.toString());

    for (const mod of relevantModules) {
      const modDecisions = [...snapshot.decisions.values()].filter(
        (d) => d.l2_module_id === mod.id
      );
      let targetLine = lineIdx;

      if (anchors) {
        const matchingAnchor = anchors.find(
          (a) => mod.name.includes(a.name) || a.name.includes(mod.name)
        );
        if (matchingAnchor) {
          targetLine = matchingAnchor.line;
        }
      }

      const range = new vscode.Range(targetLine, 0, targetLine, 0);

      const decisionCount = modDecisions.length;
      let title = `◇ L2: ${mod.name}`;
      if (decisionCount > 0) {
        title += ` (${decisionCount} L3 decisions)`;
      } else {
        title += ` (Needs decisions)`;
      }

      const l2Lens = new vscode.CodeLens(range, {
        title,
        command: "docuvia.showDecisionsForLens",
        arguments: [{ module: mod, decisions: modDecisions }],
      });
      lenses.push(l2Lens);

      const extractLens = new vscode.CodeLens(range, {
        title,
        command: "docuvia.autoCategorizeDecisions",
        arguments: [mod],
      });
      extractLens.command!.title = "Extrapolate Decisions";
      lenses.push(extractLens);

      lineIdx++;
    }

    return lenses;
  }

  private async updateSymbolAnchors(document: vscode.TextDocument): Promise<void> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri
      );
      if (!symbols) return;

      const anchors: { line: number; name: string }[] = [];
      for (const sym of symbols) {
        if (
          sym.kind === vscode.SymbolKind.Class ||
          sym.kind === vscode.SymbolKind.Function ||
          sym.kind === vscode.SymbolKind.Interface
        ) {
          anchors.push({ line: sym.range.start.line, name: sym.name });
        }
      }
      this.documentAnchors.set(document.uri.toString(), anchors);
      this._onDidChangeCodeLenses.fire();
    } catch {
      // ignore
    }
  }
}
