import * as vscode from "vscode";

export function handleHelp(stream: vscode.ChatResponseStream): void {
  stream.markdown(
    `## @docuvia — Help\n\n` +
      `| Command | Description |\n` +
      `|---------|-------------|\n` +
      `| \`/explore\` | Detect project type and suggest L1 tags for local.db |\n` +
      `| \`/query <term>\` | Search your local knowledge graph for matching modules and decisions |\n` +
      `| \`/extract [path]\` | Queue L3 decision extraction for the active file, specified file, or folder |\n` +
      `| \`/help\` | Show this help message |\n`
  );
}
