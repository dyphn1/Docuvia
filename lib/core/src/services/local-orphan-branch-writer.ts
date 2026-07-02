import Database from "better-sqlite3";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildL1TagsYaml(tagNames: string[]): string {
  if (tagNames.length === 0) return "tags: []\n";
  const lines = tagNames.map((n) => `  - ${n}`).join("\n");
  return `tags:\n${lines}\n`;
}

function buildNodeLinksYaml(links: any[]): string {
  if (links.length === 0) return "node_links: []\n";
  const lines = links
    .map(
      (l) =>
        `  - source_node_id: ${l.source_node_id}\n    target_node_id: ${l.target_node_id}\n    link_type: "${l.link_type}"`
    )
    .join("\n");
  return `node_links:\n${lines}\n`;
}

function buildL2ModuleYaml(node: any): string {
  const patterns = Array.isArray(node.source_paths) ? node.source_paths : [];
  const patternsYaml =
    patterns.length > 0
      ? `path_patterns:\n${patterns.map((p: string) => `  - "${p}"`).join("\n")}\n`
      : "path_patterns: []\n";
  return (
    [
      `id: ${node.id}`,
      `name: "${node.name}"`,
      `type: ${node.type || "module"}`,
      `description: "${(node.description ?? "").replace(/"/g, '\\"')}"`,
      patternsYaml.trimEnd(),
    ].join("\n") + "\n"
  );
}

function buildL3DecisionMd(node: any): string {
  return [
    "---",
    `id: ${node.id}`,
    `title: "${node.title.replace(/"/g, '\\"')}"`,
    `type: decision`,
    `status: ${node.status || "active"}`,
    `created_at: ${node.created_at || "null"}`,
    "---",
    "",
    node.content ?? "",
    "",
  ].join("\n");
}

function buildFastImportData(branch: string, files: Map<string, string>, nowUnix: number): string {
  const lines: string[] = [];
  lines.push(`commit refs/heads/${branch}`);
  lines.push(`committer Docuvia <docuvia@localhost> ${nowUnix} +0000`);
  const msg = `chore: pack local.db knowledge graph to branch`;
  lines.push(`data ${Buffer.byteLength(msg, "utf8")}`);
  lines.push(msg);

  // Delete and recreate project subtree
  lines.push(`deleteall`);

  for (const [filePath, content] of files) {
    const contentBytes = Buffer.from(content, "utf8");
    lines.push(`M 100644 inline ${filePath}`);
    lines.push(`data ${contentBytes.length}`);
    lines.push(content);
  }

  lines.push("");
  return lines.join("\n");
}

function runGitFastImport(workspaceRoot: string, fastImportData: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["fast-import", "--quiet", "--force"], {
      cwd: workspaceRoot,
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`git fast-import exited with code ${code}${stderr ? ": " + stderr : ""}`));
    });
    child.stdin.end(fastImportData, "utf8");
  });
}

export class LocalOrphanBranchWriter {
  constructor(private workspaceRoot: string) {}

  public async packToBranch(): Promise<void> {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Local database not found at ${dbPath}`);
    }

    try {
      await execFileAsync("git", ["--version"], { cwd: this.workspaceRoot });
    } catch {
      throw new Error("git CLI not available or not in a git repository");
    }

    const db = new Database(dbPath, { readonly: true });

    try {
      const l1TagRows = db.prepare("SELECT name FROM l1_tags").all() as any[];
      const l2Nodes = db.prepare("SELECT * FROM l2_nodes").all() as any[];
      const l3Nodes = db.prepare("SELECT * FROM l3_nodes").all() as any[];
      const nodeLinks = db.prepare("SELECT * FROM node_links").all() as any[];

      const l1TagsYaml = buildL1TagsYaml(l1TagRows.map((t) => t.name));
      const nodeLinksYaml = buildNodeLinksYaml(nodeLinks);

      const files: Map<string, string> = new Map();
      files.set(`l1_tags.yaml`, l1TagsYaml);
      files.set(`node_links.yaml`, nodeLinksYaml);

      for (const l2 of l2Nodes) {
        const l2Slug = slugify(l2.name);
        if (l2.source_paths) {
          try {
            l2.source_paths = JSON.parse(l2.source_paths);
          } catch {}
        }
        files.set(`l2_modules/${l2Slug}.yaml`, buildL2ModuleYaml(l2));

        const l3sForL2 = l3Nodes.filter((n) => n.l2_node_id === l2.id);
        for (const l3 of l3sForL2) {
          const l3Slug = slugify(l3.title || "untitled");
          const filename = `${l3.id}-${l3Slug}.md`;
          files.set(`l3_decisions/${filename}`, buildL3DecisionMd(l3));
        }
      }

      const branch = "docuvia-knowledge";
      const now = Math.floor(Date.now() / 1000);
      const fastImportData = buildFastImportData(branch, files, now);

      await runGitFastImport(this.workspaceRoot, fastImportData);
    } finally {
      db.close();
    }
  }
}
