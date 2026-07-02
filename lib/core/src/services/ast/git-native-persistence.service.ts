import fs from "node:fs/promises";
import path from "node:path";
import { ProcessedEvents, IngestionResult } from "../../types/ast-ingestion.types.js";
import { logger } from "../../utils/logger.js";

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

    // Write Markdown files
    for (const f of events.fileEvents) {
      await this.writeMarkdown(
        path.join(knowledgeDir, `${f.filePath}.md`),
        { id: f.filePath, type: "file", name: f.baseName },
        `# File: ${f.baseName}\n\nPath: \`${f.filePath}\`\n`,
        result
      );
    }

    for (const sym of [...events.classEvents, ...events.functionEvents]) {
      const parsedPath = path.parse(sym.filePath);
      const symbolMdPath = path.join(
        knowledgeDir,
        parsedPath.dir,
        parsedPath.name,
        `${sym.name}.md`
      );
      await this.writeMarkdown(
        symbolMdPath,
        { id: sym.fqn, type: "symbol", fqn: sym.fqn, filePath: sym.filePath },
        `# Symbol: ${sym.name}\n\nFQN: \`${sym.fqn}\`\n`,
        result
      );
    }
  }

  private async writeMarkdown(
    filePath: string,
    frontmatter: Record<string, string>,
    body: string,
    result: IngestionResult
  ): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      let existingContent = "";
      try {
        existingContent = await fs.readFile(filePath, "utf8");
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }

      const fm =
        "---\n" +
        Object.entries(frontmatter)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n") +
        "\n---\n";

      if (existingContent) {
        // Strip existing frontmatter if present and prepend new one
        const fmRegex = /^---[\s\S]*?---\n/;
        if (fmRegex.test(existingContent)) {
          existingContent = existingContent.replace(fmRegex, "");
        }
        await fs.writeFile(filePath, fm + existingContent, "utf8");
      } else {
        await fs.writeFile(filePath, fm + body, "utf8");
      }
    } catch (err: any) {
      result.errors.push(`Failed to write markdown file ${filePath}: ${err.message}`);
    }
  }
}
