import * as vscode from 'vscode';
import { KnowledgeStore } from './KnowledgeStore.js';
import { KnowledgeIndexer } from './indexer/KnowledgeIndexer.js';

export class DocuviaHoverProvider implements vscode.HoverProvider {
  private readonly _store: KnowledgeStore;
  private readonly _indexer: KnowledgeIndexer;

  constructor(store: KnowledgeStore, indexer: KnowledgeIndexer) {
    this._store = store;
    this._indexer = indexer;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const snapshot = this._store.getSnapshotFor(document.uri);
    if (!snapshot) return undefined;

    const matchedId = this._indexer.getMatchAt(document.uri, position.line);
    if (!matchedId) return undefined;

    const decision = snapshot.decisions.get(matchedId);
    if (decision) {
      const md = new vscode.MarkdownString();
      md.isTrusted = { enabledCommands: ['docuvia.openDecision'] };
      md.appendMarkdown(`**L3 Decision** — ${decision.title}\n\n`);
      md.appendMarkdown(`**Status**: \`${decision.status}\`\n\n`);
      if (decision.body) {
        const preview = decision.body.slice(0, 200) + (decision.body.length > 200 ? '…' : '');
        md.appendMarkdown(`---\n\n${preview}`);
      }
      if (decision.filePath) {
        md.appendMarkdown(`\n\n[Open Decision](command:docuvia.openDecision?${encodeURIComponent(JSON.stringify([decision.filePath]))})`);
      }
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }

    return undefined;
  }
}
