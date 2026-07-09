import * as vscode from "vscode";
import { QueryService } from "@workspace/core";
import {
  MSG_QUERY_USAGE,
  MSG_QUERY_NO_WORKSPACE,
  MSG_QUERY_NO_RESULTS,
  MSG_QUERY_MATCHING_L2,
  MSG_QUERY_MATCHING_L3,
  MSG_QUERY_FAILED,
} from "../../constants/index.js";

export async function handleQuery(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream
): Promise<void> {
  const query = request.prompt.trim().toLowerCase();
  if (!query) {
    stream.markdown(MSG_QUERY_USAGE);
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown(MSG_QUERY_NO_WORKSPACE);
    return;
  }

  try {
    const queryService = new QueryService(workspaceRoot);
    const results = await queryService.query(query, {});

    if (!results.l2 && results.l3.length === 0) {
      stream.markdown(MSG_QUERY_NO_RESULTS.replace("{0}", query));
      return;
    }

    if (results.l2) {
      stream.markdown(
        MSG_QUERY_MATCHING_L2.replace("{0}", results.l2.name).replace("{1}", results.l2.slug || "")
      );
    }

    if (results.l3.length > 0) {
      stream.markdown(
        MSG_QUERY_MATCHING_L3 +
          results.l3
            .map((d: any) => `- **${d.title}**\n  > ${d.content.substring(0, 100)}...`)
            .join("\n")
      );
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    stream.markdown(`${MSG_QUERY_FAILED}${errorMsg}`);
  }
}
