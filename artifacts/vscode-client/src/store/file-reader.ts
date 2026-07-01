import * as path from "path";
import * as vscode from "vscode";
import { LocalSnapshotService } from "@workspace/core";
import { KnowledgeGraphSnapshot, GraphEdge } from "../knowledge-store.js";
import { L1Tag, L2Module, L3RouterEntry, L3Decision } from "../types.js";

const DOCUVIA_DIR = ".docuvia";

export async function loadProjectSnapshot(
  workspaceRoot: string,
  outputChannel: vscode.OutputChannel
): Promise<KnowledgeGraphSnapshot | null> {
  const docuviaDir = vscode.Uri.file(path.join(workspaceRoot, DOCUVIA_DIR));
  try {
    await vscode.workspace.fs.stat(docuviaDir);
  } catch {
    return null;
  }

  outputChannel.appendLine(`[Docuvia] Loading knowledge graph for ${workspaceRoot}...`);
  try {
    let tags: L1Tag[] = [];
    let modules: L2Module[] = [];
    let routerIndex: L3RouterEntry[] = [];
    let decisions = new Map<string, L3Decision>();
    let projectName = path.basename(workspaceRoot);
    let edges: GraphEdge[] = [];

    // Local fallback: read from SQLite local.db via LocalSnapshotService
    if (tags.length === 0 && modules.length === 0) {
      try {
        const snapshotService = new LocalSnapshotService(workspaceRoot);
        const snapshot = snapshotService.getSnapshot();

        if (snapshot) {
          tags = snapshot.tags;
          modules = snapshot.modules;
          routerIndex = snapshot.routerIndex;
          decisions = snapshot.decisions;
          edges = snapshot.edges;

          if (snapshot.projectName && projectName === path.basename(workspaceRoot)) {
            projectName = snapshot.projectName;
          }
        }
      } catch (err) {
        outputChannel.appendLine(`[Docuvia] Local fallback failed: ${String(err)}`);
      }
    }

    outputChannel.appendLine(
      `[Docuvia] Knowledge graph loaded for ${projectName}: ${tags.length} tags, ${modules.length} modules, ${routerIndex.length} L3 entries, ${decisions.size} decisions, ${edges.length} edges.`
    );

    return {
      workspaceRoot,
      projectName,
      tags,
      modules,
      routerIndex,
      decisions,
      edges,
      loadedAt: new Date(),
    };
  } catch (err) {
    outputChannel.appendLine(
      `[Docuvia] Error loading knowledge graph for ${workspaceRoot}: ${String(err)}`
    );
    return null;
  }
}

export async function readUriSafe(uri: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf-8");
  } catch {
    return "";
  }
}

export function tryParse<T>(
  fn: () => T,
  label: string,
  outputChannel: vscode.OutputChannel
): T extends any[] ? T : never {
  try {
    return fn() as T extends any[] ? T : never;
  } catch (err) {
    outputChannel.appendLine(`[Docuvia] Failed to parse ${label}: ${String(err)}`);
    return [] as unknown as T extends any[] ? T : never;
  }
}
