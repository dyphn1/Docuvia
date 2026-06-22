import * as vscode from "vscode";
import * as path from "path";
import { IntervalTree } from "./IntervalTree.js";
import { KnowledgeStore } from "../KnowledgeStore.js";
import { L3Decision } from "../types.js";

export class KnowledgeIndexer {
  private _trees = new Map<string, IntervalTree<string>>();
  private _store: KnowledgeStore;
  private _disposables: vscode.Disposable[] = [];
  private _indexingQueue = new Set<string>();

  constructor(store: KnowledgeStore) {
    this._store = store;

    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onDidChangeTextDocument(e))
    );

    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument((e) => this.onDidSaveTextDocument(e))
    );

    this._disposables.push(this._store.onDidLoad(() => this.indexSnapshot()));
  }

  public indexSnapshot() {
    this._trees.clear();
    for (const snapshot of this._store.snapshots.values()) {
      for (const entry of snapshot.routerIndex) {
        if (entry.file_path) {
          const uri = vscode.Uri.file(path.join(snapshot.workspaceRoot, entry.file_path));
          const decision = snapshot.decisions.get(entry.id);
          if (decision) {
            this.queueIndexing(uri);
          }
        }
      }
    }
  }

  private queueIndexing(uri: vscode.Uri) {
    const key = uri.toString();
    if (this._indexingQueue.has(key)) return;
    this._indexingQueue.add(key);

    setTimeout(() => {
      this._indexingQueue.delete(key);
      this.buildTreeForFile(uri);
    }, 500);
  }

  public async buildTreeForFile(uri: vscode.Uri) {
    const snapshot = this._store.getSnapshotFor(uri);
    if (!snapshot) return;

    const fileDecisions: L3Decision[] = [];
    for (const entry of snapshot.routerIndex) {
      if (entry.file_path) {
        const fullPath = path.join(snapshot.workspaceRoot, entry.file_path);
        // Compare fsPath to ensure correct matching across OS platforms
        if (vscode.Uri.file(fullPath).fsPath === uri.fsPath) {
          const decision = snapshot.decisions.get(entry.id);
          if (decision) {
            fileDecisions.push(decision);
          }
        }
      }
    }

    if (fileDecisions.length === 0) {
      this._trees.delete(uri.toString());
      return;
    }

    let symbols: vscode.DocumentSymbol[] | vscode.SymbolInformation[] = [];
    try {
      symbols =
        (await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[]>(
          "vscode.executeDocumentSymbolProvider",
          uri
        )) || [];
    } catch (e) {
      console.warn(`[Docuvia] Failed to executeDocumentSymbolProvider for ${uri.toString()}`);
    }

    const tree = new IntervalTree<string>();

    for (const decision of fileDecisions) {
      const bestMatch = this.findBestSymbolMatch(decision, symbols);
      if (bestMatch) {
        let range: vscode.Range;
        if ("range" in bestMatch) {
          range = bestMatch.range;
        } else {
          range = bestMatch.location.range;
        }
        tree.insert(range.start.line, range.end.line, decision.id);
      } else {
        tree.insert(0, 0, decision.id);
      }
    }

    this._trees.set(uri.toString(), tree);
  }

  private findBestSymbolMatch(
    decision: L3Decision,
    symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[]
  ): vscode.DocumentSymbol | vscode.SymbolInformation | undefined {
    if (!symbols || symbols.length === 0) return undefined;

    const queryWords = decision.title
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2);
    if (queryWords.length === 0) return undefined;

    let bestSymbol: vscode.DocumentSymbol | vscode.SymbolInformation | undefined;
    let maxScore = 0;

    const traverse = (syms: (vscode.DocumentSymbol | vscode.SymbolInformation)[]) => {
      for (const sym of syms) {
        let score = 0;
        const symName = sym.name.toLowerCase();
        for (const w of queryWords) {
          if (symName.includes(w)) {
            score++;
          }
        }
        if (score > maxScore) {
          maxScore = score;
          bestSymbol = sym;
        }

        if ("children" in sym && Array.isArray(sym.children)) {
          traverse(sym.children);
        }
      }
    };

    traverse(symbols);
    return bestSymbol;
  }

  public getMatchAt(uri: vscode.Uri, line: number): string | undefined {
    const tree = this._trees.get(uri.toString());
    if (!tree) return undefined;
    return tree.search(line);
  }

  private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    if (e.contentChanges.length === 0) return;
    const uriStr = e.document.uri.toString();
    const tree = this._trees.get(uriStr);
    if (!tree) return;

    const sortedChanges = [...e.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
    for (const change of sortedChanges) {
      const linesAdded = change.text.split("\n").length - 1;
      const linesRemoved = change.range.end.line - change.range.start.line;
      const delta = linesAdded - linesRemoved;

      if (delta !== 0) {
        tree.shiftRanges(change.range.start.line, delta);
      }
    }
  }

  private onDidSaveTextDocument(document: vscode.TextDocument) {
    if (this._trees.has(document.uri.toString())) {
      this.buildTreeForFile(document.uri);
    }
  }

  public dispose() {
    this._disposables.forEach((d) => d.dispose());
  }
}
