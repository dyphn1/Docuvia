import * as vscode from "vscode";
import { QueryService } from "@workspace/core";
// import { routeQuery } from "@workspace/core"; // we'll use this if it's easy to mock/setup, else we fallback.

export async function handleQuery(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream
): Promise<void> {
  const query = request.prompt.trim().toLowerCase();
  if (!query) {
    stream.markdown(
      "Usage: `/query <search term>` — searches your local `.docuvia` knowledge graph."
    );
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown("No workspace folder open.");
    return;
  }

  try {
    const queryService = new QueryService(workspaceRoot);
    const results = await queryService.query(query);

    if (!results.l2 && results.l3.length === 0) {
      stream.markdown(`No local results found for **"${query}"**.`);
      return;
    }

    if (results.l2) {
      stream.markdown(
        `### Matching L2 Module\n- **${results.l2.name}** (\`${results.l2.slug}\`)\n`
      );
    }

    if (results.l3.length > 0) {
      stream.markdown(
        `### Matching L3 Decisions\n` +
          results.l3
            .map((d) => `- **${d.title}**\n  > ${d.content.substring(0, 100)}...`)
            .join("\n")
      );
    }
  } catch (err: any) {
    stream.markdown(`Error querying knowledge graph: ${err.message}`);
  }
}
