import * as vscode from "vscode";
import { KnowledgeStore } from "./KnowledgeStore.js";
import { KnowledgeIndexer } from "./indexer/KnowledgeIndexer.js";
import { QueryService } from "@workspace/core";

export class DocuviaHoverProvider implements vscode.HoverProvider {
  private readonly _store: KnowledgeStore;
  private readonly _indexer: KnowledgeIndexer;

  constructor(store: KnowledgeStore, indexer: KnowledgeIndexer) {
    this._store = store;
    this._indexer = indexer;
  }

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const md = new vscode.MarkdownString();
    let hasContent = false;
    
    // Original Logic
    const snapshot = this._store.getSnapshotFor(document.uri);
    if (snapshot) {
      const matchedId = this._indexer.getMatchAt(document.uri, position.line);
      if (matchedId) {
        const decision = snapshot.decisions.get(matchedId);
        if (decision) {
          md.isTrusted = { enabledCommands: ["docuvia.openDecision"] };
          md.appendMarkdown(`**L3 Decision** — ${decision.title}\n\n`);
          md.appendMarkdown(`**Status**: \`${decision.status}\`\n\n`);
          if (decision.body) {
            const preview = decision.body.slice(0, 200) + (decision.body.length > 200 ? "…" : "");
            md.appendMarkdown(`---\n\n${preview}`);
          }
          if (decision.filePath) {
            md.appendMarkdown(
              `\n\n[Open Decision](command:docuvia.openDecision?${encodeURIComponent(JSON.stringify([decision.filePath]))})`
            );
          }
          hasContent = true;
        }
      }
    }

    // Blast Radius Logic
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const wordRange = document.getWordRangeAtPosition(position);
    if (folder && wordRange) {
      const symbol = document.getText(wordRange);
      try {
        const queryService = new QueryService(folder.uri.fsPath);
        const [impact, context] = await Promise.all([
          queryService.getImpact(symbol),
          queryService.getContext(symbol)
        ]);
        
        let addedBlastRadius = false;
        
        if (impact && impact.blastRadius && impact.blastRadius.length > 0) {
          if (hasContent) md.appendMarkdown("\n\n---\n\n");
          md.appendMarkdown(`**Docuvia Blast Radius for \`${symbol}\`**\n\n`);
          md.appendMarkdown(`Impacts **${impact.blastRadius.length}** node(s):\n`);
          for (const node of impact.blastRadius.slice(0, 5)) {
            md.appendMarkdown(`- \`${node.name}\` (${node.type})\n`);
          }
          if (impact.blastRadius.length > 5) {
            md.appendMarkdown(`- *...and ${impact.blastRadius.length - 5} more*\n`);
          }
          hasContent = true;
          addedBlastRadius = true;
        }

        if (context) {
          if (hasContent && !addedBlastRadius) md.appendMarkdown("\n\n---\n\n");
          if (addedBlastRadius) md.appendMarkdown("\n"); // Just a newline if blast radius was already added
          
          if (context.incoming && context.incoming.length > 0) {
            md.appendMarkdown(`**Incoming Edges (${context.incoming.length})**:\n`);
            for (const edge of context.incoming.slice(0, 5)) {
              md.appendMarkdown(`- \`${edge.source_name}\` (${edge.source_type})\n`);
            }
            if (context.incoming.length > 5) {
              md.appendMarkdown(`- *...and ${context.incoming.length - 5} more*\n`);
            }
            md.appendMarkdown("\n");
          }

          if (context.outgoing && context.outgoing.length > 0) {
            md.appendMarkdown(`**Outgoing Edges (${context.outgoing.length})**:\n`);
            for (const edge of context.outgoing.slice(0, 5)) {
              md.appendMarkdown(`- \`${edge.target_name}\` (${edge.target_type})\n`);
            }
            if (context.outgoing.length > 5) {
              md.appendMarkdown(`- *...and ${context.outgoing.length - 5} more*\n`);
            }
          }
          hasContent = true;
        }
      } catch (e) {
        // Ignore errors (e.g. database not found)
      }
    }

    if (hasContent) {
      return new vscode.Hover(md, wordRange || document.lineAt(position.line).range);
    }
    
    return undefined;
  }
}
