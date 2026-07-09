import * as vscode from "vscode";
import { QueryService } from "@workspace/core";
import {
  MSG_HOVER_BLAST_RADIUS_TITLE,
  MSG_HOVER_IMPACTS_NODES,
  MSG_HOVER_AND_MORE,
  MSG_HOVER_CONTEXT_TITLE,
  MSG_HOVER_INCOMING_EDGES,
  MSG_HOVER_OUTGOING_EDGES,
} from "./constants/index.js";

export class DocuviaHoverProvider implements vscode.HoverProvider {
  constructor() {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const md = new vscode.MarkdownString();
    let hasContent = false;

    // Blast Radius Logic
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const wordRange = document.getWordRangeAtPosition(position);

    if (folder && wordRange) {
      const symbol = document.getText(wordRange);
      try {
        const queryService = new QueryService(folder.uri.fsPath);
        const [impact, context] = await Promise.all([
          queryService.getImpact(symbol),
          queryService.getContext(symbol),
        ]);

        let addedBlastRadius = false;

        if (impact && impact.blastRadius && impact.blastRadius.length > 0) {
          md.appendMarkdown(MSG_HOVER_BLAST_RADIUS_TITLE.replace("{0}", symbol));
          md.appendMarkdown(
            MSG_HOVER_IMPACTS_NODES.replace("{0}", String(impact.blastRadius.length))
          );
          for (const node of impact.blastRadius.slice(0, 5)) {
            md.appendMarkdown(`- \`${node.name}\` (${node.type})\n`);
          }
          if (impact.blastRadius.length > 5) {
            md.appendMarkdown(
              MSG_HOVER_AND_MORE.replace("{0}", String(impact.blastRadius.length - 5))
            );
          }
          hasContent = true;
          addedBlastRadius = true;
        }

        if (context) {
          if (hasContent && !addedBlastRadius) md.appendMarkdown("\n\n---\n\n");
          if (addedBlastRadius) md.appendMarkdown("\n"); // Just a newline if blast radius was already added

          if (context.incoming && context.incoming.length > 0) {
            if (!hasContent) md.appendMarkdown(MSG_HOVER_CONTEXT_TITLE.replace("{0}", symbol));
            md.appendMarkdown(
              MSG_HOVER_INCOMING_EDGES.replace("{0}", String(context.incoming.length))
            );
            for (const edge of context.incoming.slice(0, 5)) {
              md.appendMarkdown(`- \`${edge.source_name}\` (${edge.source_type})\n`);
            }
            if (context.incoming.length > 5) {
              md.appendMarkdown(
                MSG_HOVER_AND_MORE.replace("{0}", String(context.incoming.length - 5))
              );
            }
            md.appendMarkdown("\n");
          }

          if (context.outgoing && context.outgoing.length > 0) {
            if (!hasContent) md.appendMarkdown(MSG_HOVER_CONTEXT_TITLE.replace("{0}", symbol));
            md.appendMarkdown(
              MSG_HOVER_OUTGOING_EDGES.replace("{0}", String(context.outgoing.length))
            );
            for (const edge of context.outgoing.slice(0, 5)) {
              md.appendMarkdown(`- \`${edge.target_name}\` (${edge.target_type})\n`);
            }
            if (context.outgoing.length > 5) {
              md.appendMarkdown(
                MSG_HOVER_AND_MORE.replace("{0}", String(context.outgoing.length - 5))
              );
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
