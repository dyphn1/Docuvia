import * as vscode from 'vscode';
import { KnowledgeStore } from './KnowledgeStore.js';

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export class DocuviaHoverProvider implements vscode.HoverProvider {
  private readonly _store: KnowledgeStore;

  constructor(store: KnowledgeStore) {
    this._store = store;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const snapshot = this._store.snapshot;
    if (!snapshot) return undefined;

    const wordRange = document.getWordRangeAtPosition(position, UUID_REGEX);
    if (!wordRange) return undefined;

    const id = document.getText(wordRange);

    // Priority 1: L3 Decision
    const decision = snapshot.decisions.get(id);
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
      return new vscode.Hover(md, wordRange);
    }

    // Priority 2: L2 Module
    const module = snapshot.modules.find(m => m.id === id);
    if (module) {
      const md = new vscode.MarkdownString();
      md.isTrusted = false;
      md.appendMarkdown(`**L2 Module** — ${module.name}\n\n`);
      if (module.description) {
        md.appendMarkdown(`${module.description}\n\n`);
      }
      if (module.source_paths.length > 0) {
        md.appendMarkdown(`**Source paths**: \`${module.source_paths.join('`, `')}\``);
      }
      return new vscode.Hover(md, wordRange);
    }

    // Priority 3: L1 Tag
    const tag = snapshot.tags.find(t => t.id === id);
    if (tag) {
      const md = new vscode.MarkdownString();
      md.isTrusted = false;
      md.appendMarkdown(`**L1 Tag** — ${tag.name}\n\n`);
      if (tag.description) {
        md.appendMarkdown(tag.description);
      }
      return new vscode.Hover(md, wordRange);
    }

    return undefined;
  }
}
