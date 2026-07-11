import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pLimit from "p-limit";
import { ProcessedEvents, IngestionResult } from "../../types/ast-ingestion.types.js";
import { logger } from "../../utils/logger.js";

// Bounded concurrency for the per-symbol/per-file markdown write loops below. `writeMarkdown`
// runs once per file node and once per class/function symbol — tens of thousands of times on a
// large repo — so running these fully sequentially (one fs call at a time) dominates `snapshot`'s
// wall-clock time. `os.cpus().length * 4` mirrors the concurrency heuristic already used
// elsewhere in this codebase (see `l2-processing-service.ts`'s `pLimit` usage) sized for I/O-bound
// (not CPU-bound) work, where waiting on one fs call doesn't block issuing the next.
const MARKDOWN_WRITE_CONCURRENCY = os.cpus().length * 4;

export class GitNativePersistenceService {
  public async processEvents(
    events: ProcessedEvents,
    knowledgeRoot: string,
    result: IngestionResult
  ): Promise<void> {
    const graphDir = path.join(knowledgeRoot, "graph");
    const knowledgeDir = path.join(knowledgeRoot, "knowledge");

    try {
      await fs.mkdir(graphDir, { recursive: true });
      await fs.mkdir(knowledgeDir, { recursive: true });
    } catch (err: any) {
      result.errors.push(`Failed to create directories: ${err.message}`);
      return;
    }

    const nodesFile = path.join(graphDir, "nodes.jsonl");
    const edgesFile = path.join(graphDir, "edges.jsonl");

    const nodesData: string[] = [];
    const edgesData: string[] = [];

    // Process Files
    for (const f of events.fileEvents) {
      nodesData.push(
        JSON.stringify({
          id: f.filePath,
          type: "file",
          name: f.baseName,
          filePath: f.filePath,
        })
      );
      result.l2Created++;
    }

    // Process Classes
    for (const c of events.classEvents) {
      nodesData.push(
        JSON.stringify({
          id: c.fqn,
          type: "class",
          fqn: c.fqn,
          filePath: c.filePath,
        })
      );
      result.l3Created++;
    }

    // Process Functions
    for (const fn of events.functionEvents) {
      nodesData.push(
        JSON.stringify({
          id: fn.fqn,
          type: "function",
          fqn: fn.fqn,
          filePath: fn.filePath,
        })
      );
      result.l3Created++;
    }

    // Process Imports
    for (const imp of events.importEvents) {
      edgesData.push(
        JSON.stringify({
          sourceId: imp.importerFilePath,
          targetId: imp.source, // This might need normalization, but using raw source for now
          type: "depends_on",
        })
      );
      result.linksCreated++;
    }

    // Process Calls
    for (const call of events.callEvents) {
      // In a real scenario we'd resolve targetId accurately. Here we just use the name.
      edgesData.push(
        JSON.stringify({
          sourceId: call.callerFilePath,
          targetId: call.name, // The fqn of the target if known
          type: "calls",
        })
      );
      result.linksCreated++;
    }

    try {
      if (nodesData.length > 0) {
        await fs.appendFile(nodesFile, nodesData.join("\n") + "\n", "utf8");
      }
      if (edgesData.length > 0) {
        await fs.appendFile(edgesFile, edgesData.join("\n") + "\n", "utf8");
      }
    } catch (err: any) {
      result.errors.push(`Failed to write JSONL files: ${err.message}`);
    }

    // Write Markdown files. Bounded-concurrency, not sequential — see `MARKDOWN_WRITE_CONCURRENCY`.
    // `result.errors.push(...)` inside `writeMarkdown` is safe to call concurrently: JS's
    // single-threaded event loop means array pushes from concurrent promises never interleave
    // mid-operation, and no other shared mutable state is touched by `writeMarkdown`.
    const limit = pLimit(MARKDOWN_WRITE_CONCURRENCY);

    await Promise.all(
      events.fileEvents.map((f) =>
        limit(() =>
          this.writeMarkdown(
            path.join(knowledgeDir, `${f.filePath}.md`),
            { id: f.filePath, type: "file", name: f.baseName },
            `# File: ${f.baseName}\n\nPath: \`${f.filePath}\`\n`,
            result
          )
        )
      )
    );

    await Promise.all(
      [...events.classEvents, ...events.functionEvents].map((sym) =>
        limit(() => {
          const parsedPath = path.parse(sym.filePath);
          const symbolMdPath = path.join(
            knowledgeDir,
            parsedPath.dir,
            parsedPath.name,
            `${sym.name}.md`
          );
          return this.writeMarkdown(
            symbolMdPath,
            { id: sym.fqn, type: "symbol", fqn: sym.fqn, filePath: sym.filePath },
            `# Symbol: ${sym.name}\n\nFQN: \`${sym.fqn}\`\n`,
            result
          );
        })
      )
    );
  }

  private async writeMarkdown(
    filePath: string,
    frontmatter: Record<string, string>,
    body: string,
    result: IngestionResult
  ): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      const fm =
        "---\n" +
        Object.entries(frontmatter)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n") +
        "\n---\n";

      // No existing-content read/merge here: every caller passes a path under a fresh,
      // just-created empty tempDir (see snapshot.ts's `fs.mkdtemp`), so there is never
      // pre-existing content to preserve — the read this used to do was a guaranteed
      // ENOENT on every single call, doubling this function's fs round-trips for nothing.
      await fs.writeFile(filePath, fm + body, "utf8");
    } catch (err: any) {
      result.errors.push(`Failed to write markdown file ${filePath}: ${err.message}`);
    }
  }
}
