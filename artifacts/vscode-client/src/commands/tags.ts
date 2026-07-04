import * as vscode from "vscode";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { randomUUID } from "crypto";
import { openWorkspaceLocalDatabase } from "@workspace/core";

export async function acceptL1TagsCommand(yamlContent: string, explicitRoot: string) {
  const workspaceRoot = explicitRoot;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage("Docuvia: Missing workspace root for acceptL1Tags command.");
    return;
  }

  const docuviaUri = vscode.Uri.file(path.join(workspaceRoot, ".docuvia"));
  const decisionsUri = vscode.Uri.file(path.join(workspaceRoot, ".docuvia", "l3_decisions"));

  await vscode.workspace.fs.createDirectory(docuviaUri);
  await vscode.workspace.fs.createDirectory(decisionsUri);

  try {
    const tags = parseYaml(yamlContent);
    if (Array.isArray(tags)) {
      const db = openWorkspaceLocalDatabase(workspaceRoot);
      db.exec(`
        CREATE TABLE IF NOT EXISTS l1_tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          description TEXT
        );
        CREATE TABLE IF NOT EXISTS l2_nodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          type TEXT,
          source_paths TEXT,
          l1_tag_id TEXT,
          description TEXT,
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS l3_nodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          l2_node_id INTEGER,
          title TEXT NOT NULL,
          slug TEXT NOT NULL,
          status TEXT,
          created_at TEXT,
          content TEXT
        );
        CREATE TABLE IF NOT EXISTS node_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_node_id INTEGER NOT NULL,
          target_node_id INTEGER NOT NULL,
          link_type TEXT,
          commit_sha TEXT,
          diff_summary TEXT
        );
      `);

      const insert = db.prepare(
        "INSERT OR REPLACE INTO l1_tags (id, name, slug, description) VALUES (?, ?, ?, ?)"
      );
      for (const tag of tags) {
        const name = tag.name || "Unnamed";
        const slug =
          tag.slug ||
          name
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "");
        const id = tag.id || randomUUID();
        const description = tag.description || "";
        insert.run(id, name, slug, description);
      }
      db.close();
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to insert L1 tags into local.db: ${err}`);
  }

  vscode.commands.executeCommand("docuvia.knowledgeGraph.refresh");
  void vscode.window.showInformationMessage(
    "Docuvia: L1 tags imported into local.db and knowledge graph initialized."
  );
}
