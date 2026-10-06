/** Compare the graph projection of Slice B's enriched AST with the exact HEAD-shaped projection. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isDiscoverableSourceFile,
  MAX_FILE_SIZE_BYTES,
  type DiscoveredFile,
  type ParsedAstFileResult,
} from "../../lib/contracts/src/index.js";
import { AstProcessingService } from "../../lib/core/src/ast/ast-processing.service.js";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import { GraphPersisterService } from "../../lib/core/src/graph/phase393-graph-persister.js";
import { CallResolutionHypothesisService } from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import { GraphStore } from "../../lib/schema/src/index.js";

const BASELINE_COMMIT = "9ad485c10272584f05679698ec5309d8c2daecad";
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");

type StableRow = Record<string, unknown>;

function parseOptions(argv: readonly string[]): {
  readonly snapshotRoot: string;
  readonly outputPath: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !["--snapshot-root", "--out"].includes(key ?? "") ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(
        "Usage: phase2-default-import-graph-parity.mts --snapshot-root <HEAD archive> --out <summary.json>",
      );
    values.set(key, value);
  }
  const snapshotRoot = values.get("--snapshot-root");
  const outputPath = values.get("--out");
  if (!snapshotRoot || !outputPath)
    throw new Error(
      "Usage: phase2-default-import-graph-parity.mts --snapshot-root <HEAD archive> --out <summary.json>",
    );
  return {
    snapshotRoot: path.resolve(snapshotRoot),
    outputPath: path.resolve(outputPath),
  };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function walkSourceFiles(root: string): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => right.name.localeCompare(left.name),
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const file = path.relative(root, absolutePath).replace(/\\/g, "/");
      if (!isDiscoverableSourceFile(file)) continue;
      const fileStat = statSync(absolutePath);
      if (fileStat.size > MAX_FILE_SIZE_BYTES) continue;
      const bytes = readFileSync(absolutePath);
      files.push({
        file,
        hash: sha256(bytes),
        code: bytes.toString("utf8"),
      });
    }
  }
  return files.sort((left, right) => left.file.localeCompare(right.file));
}

function baselineAstProjection(
  parsedResults: readonly ParsedAstFileResult[],
): ParsedAstFileResult[] {
  // HEAD 9ad485 has no combined-default import descriptor and no `export default` descriptor.
  // Those are the only parser output changes in Slice B; retain all shared data verbatim.
  return parsedResults.map((result) => ({
    ...result,
    data: {
      ...result.data,
      imports: (result.data.imports ?? []).filter(
        (descriptor) => !descriptor.isCombinedDefaultImport,
      ),
      exports: (result.data.exports ?? []).filter(
        (descriptor) => descriptor.name !== "default",
      ),
    },
  }));
}

function canonicalRows(rows: readonly StableRow[]): string[] {
  return rows.map((row) => JSON.stringify(row)).sort();
}

function nodeRows(store: GraphStore): StableRow[] {
  return store.graph.getAllNodes().map((node) => {
    const {
      id: _id,
      created_at: _createdAt,
      last_verified_at: _lastVerifiedAt,
      updated_at: _updatedAt,
      ...stableNode
    } = node;
    return stableNode;
  });
}

function linkRows(store: GraphStore): StableRow[] {
  const nodeKeyById = new Map(
    store.graph.getAllNodes().map((node) => [node.id, node.node_key]),
  );
  return store.graph.getAllLinks().map((link) => {
    const {
      id: _id,
      source_node_id: _sourceNodeId,
      target_node_id: _targetNodeId,
      created_at: _createdAt,
      ...stableLink
    } = link;
    return {
      ...stableLink,
      source_node_key: nodeKeyById.get(link.source_node_id),
      target_node_key: nodeKeyById.get(link.target_node_id),
    };
  });
}

async function persistProjection(
  snapshotRoot: string,
  databasePath: string,
  projection: "HEAD-9ad485c" | "working-tree",
  parsedResults: ParsedAstFileResult[],
): Promise<{
  readonly nodeRows: readonly StableRow[];
  readonly linkRows: readonly StableRow[];
  readonly linkCountsByType: Readonly<Record<string, number>>;
}> {
  const store = await GraphStore.open({ dbPath: databasePath });
  try {
    const projectId = store.projects.insert({
      name: `phase2-${projection}`,
      repoUrl: `file:///${projection}`,
    }).id;
    await new GraphPersisterService(
      new CallResolutionHypothesisService(),
    ).persist({
      store,
      workspaceRoot: snapshotRoot,
      projectId,
      parsedResults,
      sourceIndexComplete: true,
      tags: [],
    });
    const nodes = nodeRows(store);
    const links = linkRows(store);
    const linkCountsByType = links.reduce<Record<string, number>>(
      (counts, link) => {
        const type = String(link.link_type);
        counts[type] = (counts[type] ?? 0) + 1;
        return counts;
      },
      {},
    );
    return {
      nodeRows: canonicalRows(nodes),
      linkRows: canonicalRows(links),
      linkCountsByType,
    };
  } finally {
    await store.close();
  }
}

function setDiff(
  baseline: readonly string[],
  workingTree: readonly string[],
): {
  readonly removedFromWorkingTree: string[];
  readonly addedInWorkingTree: string[];
} {
  const baselineCounts = new Map<string, number>();
  const workingCounts = new Map<string, number>();
  for (const row of baseline)
    baselineCounts.set(row, (baselineCounts.get(row) ?? 0) + 1);
  for (const row of workingTree)
    workingCounts.set(row, (workingCounts.get(row) ?? 0) + 1);
  const removedFromWorkingTree: string[] = [];
  const addedInWorkingTree: string[] = [];
  for (const [row, count] of baselineCounts) {
    const difference = count - (workingCounts.get(row) ?? 0);
    for (let index = 0; index < difference; index++)
      removedFromWorkingTree.push(row);
  }
  for (const [row, count] of workingCounts) {
    const difference = count - (baselineCounts.get(row) ?? 0);
    for (let index = 0; index < difference; index++)
      addedInWorkingTree.push(row);
  }
  return {
    removedFromWorkingTree: removedFromWorkingTree.sort(),
    addedInWorkingTree: addedInWorkingTree.sort(),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const discoveredFiles = walkSourceFiles(options.snapshotRoot);
  const pool = new AstWorkerPool();
  const processor = new AstProcessingService({
    initialize: async () => pool.initialize(2),
    parse: (request) => pool.parse(request),
    terminate: () => pool.terminate(),
    serializeBatch: (fn) => fn(),
  });
  const beforeParseRss = process.memoryUsage().rss;
  let peakRss = beforeParseRss;
  const memorySampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 250);
  memorySampler.unref();
  const parsed = await processor.processFiles(
    options.snapshotRoot,
    discoveredFiles,
  );
  clearInterval(memorySampler);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  if (parsed.failures.length > 0)
    throw new Error(
      `AST parsing failed for ${parsed.failures.length} source files.`,
    );

  const tempDatabaseRoot = await import("node:fs").then(({ mkdtempSync }) =>
    mkdtempSync(path.join(os.tmpdir(), "docuvia-phase2-graph-parity-")),
  );
  let baseline: Awaited<ReturnType<typeof persistProjection>>;
  let workingTree: Awaited<ReturnType<typeof persistProjection>>;
  try {
    baseline = await persistProjection(
      options.snapshotRoot,
      path.join(tempDatabaseRoot, "baseline.db"),
      "HEAD-9ad485c",
      baselineAstProjection(parsed.parsed),
    );
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    workingTree = await persistProjection(
      options.snapshotRoot,
      path.join(tempDatabaseRoot, "working-tree.db"),
      "working-tree",
      parsed.parsed,
    );
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  } finally {
    const { rmSync } = await import("node:fs");
    rmSync(tempDatabaseRoot, { recursive: true, force: true });
  }

  const nodeDiff = setDiff(baseline.nodeRows, workingTree.nodeRows);
  const linkDiff = setDiff(baseline.linkRows, workingTree.linkRows);
  const summary = {
    schemaVersion: 1,
    baselineCommit: BASELINE_COMMIT,
    comparison:
      "same committed HEAD source snapshot; HEAD-shaped AST projection vs working-tree AST projection",
    sourceFiles: discoveredFiles.length,
    parsedFiles: parsed.parsed.length,
    parseFailures: parsed.failures.length,
    candidateOnlyCombinedDefaultImports: parsed.parsed.reduce(
      (count, result) =>
        count +
        (result.data.imports ?? []).filter(
          (descriptor) => descriptor.isCombinedDefaultImport,
        ).length,
      0,
    ),
    candidateOnlyDefaultExports: parsed.parsed.reduce(
      (count, result) =>
        count +
        (result.data.exports ?? []).filter(
          (descriptor) => descriptor.name === "default",
        ).length,
      0,
    ),
    baseline: {
      nodeCount: baseline.nodeRows.length,
      nodeRowsSha256: sha256(`${baseline.nodeRows.join("\n")}\n`),
      nodeLinksByType: baseline.linkCountsByType,
      nodeLinkCount: baseline.linkRows.length,
      nodeLinkRowsSha256: sha256(`${baseline.linkRows.join("\n")}\n`),
    },
    workingTree: {
      nodeCount: workingTree.nodeRows.length,
      nodeRowsSha256: sha256(`${workingTree.nodeRows.join("\n")}\n`),
      nodeLinksByType: workingTree.linkCountsByType,
      nodeLinkCount: workingTree.linkRows.length,
      nodeLinkRowsSha256: sha256(`${workingTree.linkRows.join("\n")}\n`),
    },
    exactDiff: {
      nodes: nodeDiff,
      nodeLinks: linkDiff,
      empty:
        nodeDiff.addedInWorkingTree.length === 0 &&
        nodeDiff.removedFromWorkingTree.length === 0 &&
        linkDiff.addedInWorkingTree.length === 0 &&
        linkDiff.removedFromWorkingTree.length === 0,
    },
    peakRssBytes: peakRss,
  };
  writeFileSync(options.outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.peakRssBytes >= 6 * 1024 * 1024 * 1024)
    throw new Error("Graph parity process exceeded the 6 GiB RSS ceiling.");
  if (!summary.exactDiff.empty)
    throw new Error("HEAD and working-tree graph projections differ.");
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
