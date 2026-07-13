import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pLimit from "p-limit";
import type {
  ISnapshotRenderer,
  SnapshotRenderInput,
  SnapshotRenderResult,
} from "@workspace/contracts";

// Bounded concurrency for the per-symbol/per-file markdown write loop below, mirroring old
// Docuvia's `GitNativePersistenceService.processEvents()`: running these fully sequentially (one
// fs call at a time) dominated `snapshot`'s wall-clock time on repos with tens of thousands of
// small files.
const MARKDOWN_WRITE_CONCURRENCY = os.cpus().length * 4;

interface RenderNode {
  id: string;
  kind: "file" | "symbol";
  name: string;
  type: string;
  filePath?: string;
}

/**
 * Renders the current knowledge-graph state (already persisted to `IGraphStore`) into the
 * git-diffable directory shape `snapshot` packs onto the hidden knowledge branch — `graph/
 * nodes.jsonl`, `graph/edges.jsonl`, and one markdown file per file/symbol node under
 * `knowledge/`. Pure directory rendering (Domain Core, no git operations of its own — see
 * `KnowledgeGitService.packSnapshotToKnowledgeBranch()` for the git-write step).
 *
 * A node is classified "file" vs "symbol" by whether it's the target of a `contains` link — the
 * same convention `TopologyBuilderService` uses (see `lib/core/src/topology/
 * topology-builder.service.ts`), rather than name/path comparison, since `persist-ast-graph.ts`
 * currently persists every node (file, function, class) with `type: "module"`.
 */
export class SnapshotRendererService implements ISnapshotRenderer {
  public async render(
    input: SnapshotRenderInput,
  ): Promise<SnapshotRenderResult> {
    const { outDir, l2Rows, linkRows } = input;

    const graphDir = path.join(outDir, "graph");
    const knowledgeDir = path.join(outDir, "knowledge");
    await fs.mkdir(graphDir, { recursive: true });
    await fs.mkdir(knowledgeDir, { recursive: true });

    const filePathById = new Map<number, string | undefined>();
    for (const row of l2Rows)
      filePathById.set(row.id, parsePathPattern(row.path_patterns));

    // A node is a "symbol" iff some `contains` link targets it; its containing file's id comes
    // from that same link's source.
    const containingFileIdByNodeId = new Map<number, number>();
    for (const link of linkRows) {
      if (link.link_type === "contains") {
        containingFileIdByNodeId.set(link.target_node_id, link.source_node_id);
      }
    }

    // node_key (STOR-005) is the deterministic, cross-machine export identity; rowid ("l2:<id>")
    // is only a fallback for rows persisted before the node_key column existed.
    const nodeKeyById = new Map<number, string>();
    for (const row of l2Rows)
      nodeKeyById.set(row.id, row.node_key ?? "l2:" + row.id);

    const nodes: RenderNode[] = l2Rows.map((row) => {
      const containingFileId = containingFileIdByNodeId.get(row.id);
      return {
        id: nodeKeyById.get(row.id)!,
        kind: containingFileId !== undefined ? "symbol" : "file",
        name: row.name,
        type: row.type,
        filePath:
          containingFileId !== undefined
            ? filePathById.get(containingFileId)
            : filePathById.get(row.id),
      };
    });

    const nodesData = nodes.map((node) =>
      JSON.stringify({
        id: node.id,
        type: node.kind,
        name: node.name,
        filePath: node.filePath,
      }),
    );
    const edgesData = linkRows.map((link) =>
      JSON.stringify({
        source:
          nodeKeyById.get(link.source_node_id) ?? "l2:" + link.source_node_id,
        target:
          nodeKeyById.get(link.target_node_id) ?? "l2:" + link.target_node_id,
        type: link.link_type,
      }),
    );

    if (nodesData.length > 0) {
      await fs.writeFile(
        path.join(graphDir, "nodes.jsonl"),
        nodesData.join("\n") + "\n",
        "utf8",
      );
    }
    if (edgesData.length > 0) {
      await fs.writeFile(
        path.join(graphDir, "edges.jsonl"),
        edgesData.join("\n") + "\n",
        "utf8",
      );
    }

    const limit = pLimit(MARKDOWN_WRITE_CONCURRENCY);
    let markdownFilesWritten = 0;
    // Per-node failures (e.g. a malformed/AST-derived `filePath`/`name` that still resolves
    // outside `knowledgeDir` after sanitization) are collected here rather than rejecting the
    // whole `Promise.all(...)` — mirrors old Docuvia's `GitNativePersistenceService.
    // processEvents()`, which accumulated per-file failures into `result.errors` instead of
    // aborting the batch. Safe to push from concurrent promises: JS's single-threaded event loop
    // never interleaves array pushes mid-operation.
    const errors: string[] = [];

    await Promise.all(
      nodes.map((node) =>
        limit(async () => {
          try {
            const mdPath = markdownPathFor(knowledgeDir, node);
            if (!mdPath) return;
            await this.writeMarkdown(mdPath, node);
            markdownFilesWritten++;
          } catch (err) {
            errors.push(
              `Failed to write markdown for node ${node.id} (${node.name}): ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }),
      ),
    );

    return {
      nodesWritten: nodesData.length,
      edgesWritten: edgesData.length,
      markdownFilesWritten,
      errors,
    };
  }

  private async writeMarkdown(mdPath: string, node: RenderNode): Promise<void> {
    await fs.mkdir(path.dirname(mdPath), { recursive: true });

    const frontmatter =
      "---\n" +
      `id: ${node.id}\n` +
      `type: ${node.kind}\n` +
      `name: ${node.name}\n` +
      (node.filePath ? `filePath: ${node.filePath}\n` : "") +
      "---\n";

    const body =
      node.kind === "file"
        ? `# File: ${node.name}\n\nPath: \`${node.filePath ?? node.name}\`\n`
        : `# Symbol: ${node.name}\n\nFile: \`${node.filePath ?? ""}\`\n`;

    await fs.writeFile(mdPath, frontmatter + body, "utf8");
  }
}

// Characters illegal (or reserved) in filenames on common filesystems, plus ASCII control chars.
const ILLEGAL_FILENAME_CHARS = /[<>:"|?*\x00-\x1f]/g;

/**
 * Sanitizes a single path segment (a directory or file name, never a full path) for safe use on
 * disk: illegal/control characters are replaced with `_`. Does not handle `..`/`.` traversal —
 * callers filter those out at the segment-splitting stage in `sanitizeRelativePath`.
 */
function sanitizeSegment(segment: string): string {
  return segment.replace(ILLEGAL_FILENAME_CHARS, "_");
}

/**
 * Sanitizes a `/`- or `\`-separated relative path (e.g. a DB-sourced `filePath`, which may be
 * malformed or AST-derived with unusual characters) for safe use under `knowledgeDir`: rejects
 * `..`/`.` traversal segments and empty segments, and replaces filesystem-illegal characters
 * within each remaining segment.
 */
function sanitizeRelativePath(relPath: string): string {
  return relPath
    .split(/[\\/]+/)
    .filter(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    )
    .map(sanitizeSegment)
    .join(path.sep);
}

/**
 * Joins `relPath` onto `knowledgeDir` and asserts the resolved path is still contained within
 * `knowledgeDir` — defense-in-depth against path traversal beyond `sanitizeRelativePath`'s segment
 * filtering above. Throws (caught by the per-node try/catch in `render()`) rather than returning
 * an escaping path.
 */
function resolveWithinKnowledgeDir(
  knowledgeDir: string,
  relPath: string,
): string {
  const resolvedKnowledgeDir = path.resolve(knowledgeDir);
  const resolved = path.resolve(resolvedKnowledgeDir, relPath);
  if (
    resolved !== resolvedKnowledgeDir &&
    !resolved.startsWith(resolvedKnowledgeDir + path.sep)
  ) {
    throw new Error(
      `Sanitized markdown path escapes knowledge directory: ${relPath}`,
    );
  }
  return resolved;
}

function markdownPathFor(
  knowledgeDir: string,
  node: RenderNode,
): string | undefined {
  if (node.kind === "file") {
    if (!node.filePath) return undefined;
    return resolveWithinKnowledgeDir(
      knowledgeDir,
      `${sanitizeRelativePath(node.filePath)}.md`,
    );
  }

  if (!node.filePath) return undefined;
  const parsedPath = path.parse(sanitizeRelativePath(node.filePath));
  const safeName = sanitizeSegment(node.name);
  return resolveWithinKnowledgeDir(
    knowledgeDir,
    path.join(parsedPath.dir, parsedPath.name, `${safeName}.md`),
  );
}

function parsePathPattern(raw: string | null): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0]);
  } catch (e) {
    void e;
  }
  return raw;
}
