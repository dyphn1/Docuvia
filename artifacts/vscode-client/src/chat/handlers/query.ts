import * as vscode from "vscode";
import { KnowledgeStore } from "../../knowledge-store.js";
import { CentralServerAuthError, CentralServerClient } from "../../central-server-client.js";

export async function handleQuery(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  store: KnowledgeStore,
  centralClient: CentralServerClient
): Promise<void> {
  const query = request.prompt.trim().toLowerCase();
  if (!query) {
    stream.markdown(
      "Usage: `/query <search term>` — searches your local `.docuvia` knowledge graph."
    );
    return;
  }

  // ── Breadth routing ────────────────────────────────────────────────────────
  if (isBreadthQuery(query)) {
    await handleBreadthQuery(query, stream, centralClient);
    return;
  }

  // ── Local depth search ─────────────────────────────────────────────────────
  if (store.snapshots.size === 0) {
    stream.markdown("No `.docuvia/` folder loaded. Run **Docuvia: Init Project** first.");
    return;
  }

  const matchingModules: import("../../types.js").L2Module[] = [];
  const matchingDecisions: import("../../types.js").L3Decision[] = [];

  for (const snapshot of store.snapshots.values()) {
    matchingModules.push(
      ...snapshot.modules.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.slug.includes(query) ||
          (m.description ?? "").toLowerCase().includes(query)
      )
    );

    matchingDecisions.push(
      ...[...snapshot.decisions.values()].filter(
        (d) => d.title.toLowerCase().includes(query) || d.body.toLowerCase().includes(query)
      )
    );
  }

  if (matchingModules.length === 0 && matchingDecisions.length === 0) {
    stream.markdown(`No local results found for **"${query}"**.`);
    return;
  }

  if (matchingModules.length > 0) {
    stream.markdown(
      `### Matching L2 Modules\n` +
        matchingModules
          .map((m) => `- **${m.name}** (\`${m.slug}\`) — ${m.description ?? ""}`)
          .join("\n")
    );
  }

  if (matchingDecisions.length > 0) {
    stream.markdown(
      `### Matching L3 Decisions\n` +
        matchingDecisions
          .slice(0, 5)
          .map((d) => `- **${d.title}** [${d.status}] — \`${d.filePath}\``)
          .join("\n")
    );
  }
}

/** Detect cross-project "breadth" queries that should be routed to the central server. */
function isBreadthQuery(query: string): boolean {
  const breadthPatterns = ["other projects", "cross-project", "how do others", "how do other"];
  return query.startsWith("@") || breadthPatterns.some((p) => query.includes(p));
}

async function handleBreadthQuery(
  query: string,
  stream: vscode.ChatResponseStream,
  centralClient: CentralServerClient
): Promise<void> {
  stream.progress("Searching cross-project knowledge...");
  try {
    const results = await centralClient.query(query, 10);
    if (results.length === 0) {
      stream.markdown(
        `No cross-project results found for **"${query}"**.` +
          (centralClient.isServerConfigured()
            ? ""
            : "\n\n_Tip: Configure `server_url` in `~/.docuvia/config.yaml` to enable cross-project search._")
      );
      return;
    }
    stream.markdown(`### Cross-Project Results\n`);
    for (const r of results) {
      const tags = r.l1Tags.length > 0 ? ` · \`${r.l1Tags.join("`, `")}\`` : "";
      stream.markdown(`**${r.title}** — _${r.projectName}_${tags}\n> ${r.snippet}\n`);
    }
  } catch (err) {
    if (err instanceof CentralServerAuthError) {
      void vscode.window.showErrorMessage(
        "Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."
      );
      stream.markdown(
        "_Authentication required. Set your server token via the Command Palette: **Docuvia: Set Server Token**._"
      );
    } else {
      stream.markdown(`_Cross-project search failed: ${String(err)}_`);
    }
  }
}
