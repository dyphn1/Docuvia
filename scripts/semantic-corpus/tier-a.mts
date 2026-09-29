/** C-02 Tier A extraction: runs Docuvia's own AST ingestion (no Tier B) on a snapshot and reads
 *  the resulting graph read-only (#506). */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  SemanticCollectionCallSite,
  SemanticCollectionGraphEdge,
  SemanticCollectionGraphNode,
} from "../../lib/contracts/src/index.js";

import { offlineEnv } from "./run-support.mjs";

const requireFromSchema = createRequire(
  path.resolve(import.meta.dirname, "../../lib/schema/package.json"),
);
const Database = requireFromSchema(
  "better-sqlite3",
) as typeof import("better-sqlite3");

export const DOCUVIA_CLI = path.resolve(
  import.meta.dirname,
  "../../artifacts/cli/dist/cli.js",
);
const GRAPH_DB = ".docuvia/local.db";

export interface TierAGraph {
  readonly nodes: SemanticCollectionGraphNode[];
  readonly edges: SemanticCollectionGraphEdge[];
  readonly callSites: SemanticCollectionCallSite[];
}

/** Runs `docuvia analyze` (auto mode → full ingestion on an empty graph). */
export function runTierA(dir: string, heapMb: number): number {
  const started = performance.now();
  execFileSync(
    process.execPath,
    [`--max-old-space-size=${heapMb}`, DOCUVIA_CLI, "analyze"],
    {
      cwd: dir,
      stdio: ["ignore", "ignore", "pipe"],
      env: offlineEnv(),
    },
  );
  return performance.now() - started;
}

interface NodeRow {
  node_key: string;
  name: string;
}
interface EdgeRow {
  source: string;
  target: string;
  link_type: string;
}
interface CallRow {
  file_path: string;
  start_line: number;
  start_column: number;
  callee_name: string | null;
  target_function: string;
  callee_kind: string | null;
}

export function readTierAGraph(dir: string): TierAGraph {
  const db = new Database(path.join(dir, GRAPH_DB), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const nodes = (
      db
        .prepare("SELECT node_key, name FROM l2_nodes ORDER BY node_key")
        .all() as NodeRow[]
    ).map((row) => ({
      nodeKey: row.node_key,
      name: row.name,
      filePath: row.node_key.split("#")[0],
    }));
    const edges = (
      db
        .prepare(
          `SELECT s.node_key AS source, t.node_key AS target, l.link_type FROM node_links l
           JOIN l2_nodes s ON s.id = l.source_node_id JOIN l2_nodes t ON t.id = l.target_node_id
           WHERE l.link_type IN ('calls', 'imports') ORDER BY source, target, l.link_type`,
        )
        .all() as EdgeRow[]
    ).map((row) => ({
      sourceKey: row.source,
      targetKey: row.target,
      kind: row.link_type as "calls" | "imports",
    }));
    const callSites = (
      db
        .prepare(
          `SELECT file_path, start_line, start_column, callee_name, target_function, callee_kind
           FROM ast_call_sites ORDER BY file_path, start_line, start_column`,
        )
        .all() as CallRow[]
    ).map((row) => ({
      filePath: row.file_path,
      line: row.start_line,
      column: row.start_column,
      calleeName: row.callee_name ?? row.target_function.split(".").pop()!,
      calleeKind: row.callee_kind,
    }));
    return { nodes, edges, callSites };
  } finally {
    db.close();
  }
}
