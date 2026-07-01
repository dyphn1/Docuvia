import * as path from "path";
import { KnowledgeSnapshot, L1Tag, L2Module, L3RouterEntry, L3Decision } from "../types.js";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function mapApiSnapshot(
  snapshot: KnowledgeSnapshot,
  workspaceRoot: string
): {
  projectName: string;
  tags: L1Tag[];
  modules: L2Module[];
  routerIndex: L3RouterEntry[];
  decisions: Map<string, L3Decision>;
} {
  const tags: L1Tag[] = snapshot.l1Tags.map((t) => ({
    id: String(t.id),
    slug: slugify(t.name),
    name: t.name,
    description: t.description ?? undefined,
  }));

  const modules: L2Module[] = snapshot.l2Nodes.map((n) => ({
    id: String(n.id),
    slug: slugify(n.name),
    name: n.name,
    description: n.description ?? undefined,
    l1_tag_id: n.l1TagIds[0] !== undefined ? String(n.l1TagIds[0]) : "",
    source_paths: [],
  }));

  const routerIndex: L3RouterEntry[] = snapshot.l3Nodes.map((n) => ({
    id: String(n.id),
    l2_module_id: String(n.l2NodeId),
    slug: slugify(n.title),
    title: n.title,
    file_path: "",
  }));

  const decisions = new Map<string, L3Decision>();
  for (const n of snapshot.l3Nodes) {
    const id = String(n.id);
    decisions.set(id, {
      id,
      l2_module_id: String(n.l2NodeId),
      title: n.title,
      status: "accepted",
      body: n.content ?? "",
      filePath: "",
    });
  }

  return {
    projectName: path.basename(workspaceRoot),
    tags,
    modules,
    routerIndex,
    decisions,
  };
}
