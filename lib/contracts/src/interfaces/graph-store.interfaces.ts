/**
 * Row shapes for the local SQLite schema (see `lib/schema`'s migrations). Defined here, not in
 * `lib/schema`, per the Virtual Contracts "Mandatory Mapping" rule — `lib/schema` must map its
 * raw driver output onto these before returning from any repo method; nothing above this layer
 * may depend on `lib/schema` types directly. Numeric booleans (SQLite has no native boolean
 * type) are typed as `0 | 1`, matching what `better-sqlite3` hands back without an explicit
 * conversion layer.
 */
export const ProjectStatuses = {
  ACTIVE: "active",
  ARCHIVED: "archived",
} as const;
export type ProjectStatus =
  (typeof ProjectStatuses)[keyof typeof ProjectStatuses];

export interface ProjectRow {
  id: number;
  name: string;
  repo_url: string;
  description: string | null;
  status: ProjectStatus;
  vcs_type: string;
  svn_url: string | null;
  last_git_ingested_at: string | null;
  last_svn_revision: number | null;
  last_ast_ingested_at: string | null;
  owner_id: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectFileRow {
  id: number;
  project_id: number;
  file_path: string;
  content_hash: string | null;
  last_parsed_at: string | null;
  created_at: string;
  /** Tier B analogue of `last_parsed_at` (Tier A) — null means this file has never had its
   *  outgoing `calls` edges (re)computed by a Tier B batch. See `0006_tier_b_file_status.sql`. */
  last_tier_b_processed_at: string | null;
  /** HEAD sha at the time this file was last Tier B-processed — null when
   *  `last_tier_b_processed_at` is also null, or when the batch ran on an unborn/headless HEAD. */
  last_tier_b_commit_sha: string | null;
}

export interface L1TagRow {
  id: number;
  name: string;
  slug: string;
  category: string;
  is_anchored: 0 | 1;
  usage_count: number;
  description: string | null;
  created_at: string;
}

export const L2NodeTypes = {
  MODULE: "module",
  PACKAGE: "package",
  PCD: "pcd",
} as const;
export type L2NodeType = (typeof L2NodeTypes)[keyof typeof L2NodeTypes];

export interface L2NodeRow {
  id: number;
  project_id: number;
  name: string;
  type: L2NodeType;
  is_system: 0 | 1;
  description: string | null;
  ai_generated: 0 | 1;
  needs_review: 0 | 1;
  created_at: string;
  last_verified_at: string | null;
  path_patterns: string | null;
  reindex_required: 0 | 1;
  is_bootstrap_confirmed: 0 | 1;
  content_hash: string | null;
  updated_at: string;
  /** Deterministic `<file_path>` / `<file_path>#<symbolName>` identity (STOR-005). Null on rows inserted before this column existed. */
  node_key: string | null;
}

export const LinkTypes = {
  CONTAINS: "contains",
  CALLS: "calls",
  IMPLEMENTS: "implements",
  EXTENDS: "extends",
  IMPORTS: "imports",
  DEPENDS_ON: "depends_on",
  DECISION: "decision",
} as const;
export type LinkType = (typeof LinkTypes)[keyof typeof LinkTypes];

export interface NodeLinkRow {
  id: number;
  source_node_id: number;
  target_node_id: number;
  link_type: LinkType;
  commit_sha: string | null;
  diff_summary: string | null;
  created_at: string;
}

export interface L2NodeL1TagRow {
  l2_node_id: number;
  l1_tag_id: number;
  created_at: string;
}

export const L3NodeTypes = {
  CHANGE: "change",
  RULE: "rule",
  DECISION: "decision",
  CONTEXT: "context",
} as const;
export type L3NodeType = (typeof L3NodeTypes)[keyof typeof L3NodeTypes];

export const ValidityStatuses = {
  PENDING: "pending",
  ACTIVE: "active",
  DRAFT: "draft",
  GARBAGE: "garbage",
} as const;
export type ValidityStatus =
  (typeof ValidityStatuses)[keyof typeof ValidityStatuses];

/** `l3_nodes.source` values. `ANALYZE` = the existing LLM decision-extraction pipeline
 *  (`analyze <targetPath>`, no --agent-authored). `AGENT_AUTHORED` = an AI coding agent's own
 *  structured decision, written verbatim (no LLM call) via `analyze <targetPath> --agent-authored`
 *  (roadmap items 32-34, issue #42). `IMPORT` mirrors L3NodesRepo's private `L3_IMPORT_SOURCE`
 *  ('git-import') -- included here so every source value used in application code has one home;
 *  `L3NodesRepo.importCard` continues to hardcode its own literal for now (out of scope -- see
 *  the note below), but new code should reference this const, not a fresh string literal. */
export const L3DecisionSources = {
  ANALYZE: "analyze",
  AGENT_AUTHORED: "agent-authored",
} as const;
export type L3DecisionSource =
  (typeof L3DecisionSources)[keyof typeof L3DecisionSources];

export interface L3NodeRow {
  id: number;
  l2_node_id: number;
  title: string;
  content: string | null;
  node_type: L3NodeType;
  source_commits: string;
  commit_hash: string | null;
  ai_generated: 0 | 1;
  confidence: number | null;
  noise_score: number | null;
  created_at: string;
  last_verified_at: string | null;
  occurrence_count: number;
  introduced_in_commit: string | null;
  verified_until_commit: string | null;
  validity_status: ValidityStatus;
  source: string;
  content_hash: string | null;
  /** LLM model id used for extraction (e.g. `gpt-4o-mini`) — null on rows inserted before this column existed, or when the extraction path never set it. */
  extraction_model: string | null;
  /** JSON array of workspace-relative source file paths the decision was extracted from — null on rows inserted before this column existed. */
  source_files: string | null;
  /**
   * JSON array snapshot of `source_commits` as it stood the moment this row was first inserted —
   * frozen forever afterwards, never touched by `upsertDecision`'s later occurrence-bump path
   * (L3DIST-002/003, phase2-l3-distribution). This is what `snapshot`'s L3 card renderer packs as
   * the card's `source_commits` field, so a card's content stays byte-identical run-over-run even
   * as the local row's own (mutable) `source_commits` keeps growing with every re-analysis —
   * true git-object idempotency (L3DIST edge case 5b). Null on rows inserted before this column
   * existed; callers fall back to `source_commits` in that case.
   */
  initial_source_commits: string | null;
  /**
   * JSON array of `L3AnchorRange` ({path, startRow, endRow}) — the writing commit's diff hunks
   * over the decision's source files, captured at write time (issue #68). Gives the future
   * blame-based validity pass a region to judge ownership against instead of degenerating to
   * file-level blame. NULL on rows written before this column existed or by write paths that
   * don't capture anchors; consumers treat NULL as "unknown region" (file-level fallback),
   * never as an empty confirmed range.
   */
  anchor_ranges: string | null;
}

/**
 * One line-range region anchor for an L3 decision (issue #68): a hunk the writing commit
 * introduced in one of the decision's source files. Rows are 0-indexed inclusive, matching
 * `DiffLineRange`'s tree-sitter convention.
 */
export interface L3AnchorRange {
  /** Workspace-relative file path (node_key form, forward slashes). */
  path: string;
  startRow: number;
  endRow: number;
}

/**
 * Small key/value store (`docuvia_meta` table) — currently used to remember the knowledge-branch
 * tip sha `local.db` was last hydrated from (STOR-002), so read commands can cheaply detect
 * staleness without re-parsing JSONL on every call.
 */
export interface IMetaRepo {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface IProjectsRepo {
  getFirst(): ProjectRow | undefined;
  insert(input: { name: string; repoUrl: string }): ProjectRow;
  /**
   * Atomic get-or-insert: returns the existing project row if one exists, otherwise inserts
   * `input` and returns the new row — all inside one write-locked transaction, so two processes
   * racing `docuvia init` on a fresh workspace can't both observe "no project yet" and both
   * insert (see seed-project-row.ts).
   */
  getOrInsert(input: { name: string; repoUrl: string }): ProjectRow;
  /** Row count of the `projects` table — used by `status`. */
  count(): number;
}

export interface IProjectFilesRepo {
  getAllHashes(): Array<{ filePath: string; contentHash: string | null }>;
  upsertFile(input: {
    projectId: number;
    filePath: string;
    contentHash: string | null;
  }): void;
  /**
   * Stamps `last_tier_b_processed_at`/`last_tier_b_commit_sha` for a file whose calls-edges Tier
   * B just (re)computed — called once per file in `outcome.filesProcessed` right after
   * `applyResolvedEdges` durably inserts that batch's edges (not staged/gated on a later
   * `snapshot`, since the edges themselves already aren't staged either). Upserts defensively (a
   * matching `project_files` row should already exist from Tier A parsing every file Tier B ever
   * queues, but this must not silently no-op if one is somehow missing).
   */
  markTierBProcessed(input: {
    projectId: number;
    filePath: string;
    commitSha: string | null;
  }): void;
  /**
   * Tier B coverage for a single file — `query`/`impact`'s "does this node's own file's
   * outgoing-edge set look complete" check. `undefined` when the file has no `project_files` row
   * at all (never parsed by Tier A, so Tier B could never have queued it either).
   */
  getTierBFileStatus(
    filePath: string,
  ):
    | { lastProcessedAt: string | null; lastProcessedCommitSha: string | null }
    | undefined;
  /**
   * Workspace-wide Tier B coverage — `query`/`impact`'s "could an unqueued file still turn out to
   * be a caller" check. Cheap aggregate (two `COUNT(*)`-shaped reads), no row materialization —
   * safe to call on every `query`/`impact` invocation, even against a 100k+-file graph.
   */
  getTierBCoverage(): { totalFiles: number; processedFiles: number };
}

export interface ITagsRepo {
  upsertTag(name: string): void;
  getIdByName(name: string): number | undefined;
  linkNodeToTag(l2NodeId: number, l1TagId: number): void;
  /**
   * Every (l2NodeId, tagName) pairing across the whole project — used by `export-topology` to
   * attach tag metadata onto file nodes (mirrors old Docuvia's `l2_node_l1_tags`/`l1_tags` join).
   */
  getAllTagLinks(): Array<{ l2NodeId: number; name: string }>;
}

/** One `l2_nodes` row plus its child `l3_nodes` rows — the shape `sync` needs to decide what to push. */
export interface L2NodeWithL3Children {
  l2Node: L2NodeRow;
  l3Nodes: L3NodeRow[];
}

export interface IGraphNodesRepo {
  deleteNodesForPath(filePath: string): number[];
  insertNode(input: {
    projectId: number;
    name: string;
    type?: string;
    description?: string;
    pathPatterns: string[];
    /**
     * Deterministic export identity (STOR-005) — `<file_path>` for file nodes,
     * `<file_path>#<symbolName>` for function/class nodes. Optional: when omitted, `GraphNodesRepo`
     * derives it from `pathPatterns[0]`/`name` using the same convention, so callers that don't
     * care about the exported id (most tests) don't need to compute it themselves.
     */
    nodeKey?: string;
    /** Feature hash of the node's own content (STOR-005) — the file's own hash for file nodes, a hash of the symbol's exact source span for function/class nodes. */
    contentHash?: string;
  }): number;
  insertLink(input: {
    sourceNodeId: number;
    targetNodeId: number;
    linkType: string;
  }): void;
  findNodeIdByName(filePath: string, name: string): number | undefined;
  /** Row counts of `l2_nodes`/`l3_nodes` — used by `status`. */
  count(): { l2Nodes: number; l3Nodes: number };
  /**
   * l2_nodes whose `path_patterns` intersects `changedFiles`, each paired with its l3_nodes —
   * used by `sync` to find locally-generated decisions to push for a changed-file set (mirrors
   * old Docuvia's `SyncService.readLocalCandidates`).
   */
  findNodesForChangedFiles(changedFiles: string[]): L2NodeWithL3Children[];
  /**
   * Resolves a node by name for `query`/`impact`/`review`'s blast-radius lookups: exact match
   * first, falling back to a `LIKE %target%` match (mirrors old Docuvia's
   * `QueryService.findNodeByName`). Undefined when nothing matches either way. `filePath` is the
   * first `path_patterns` entry (undefined for a row with none) — `query`'s only consumer of it,
   * since an empty `<l2_module>` block with no file/kind context was otherwise indistinguishable
   * from a genuinely-empty result.
   */
  findNodeByName(
    target: string,
  ): { id: number; name: string; type: string; filePath?: string } | undefined;
  /**
   * Resolves an l2_node's id by its exact STOR-005 `node_key` (deterministic `<file_path>` /
   * `<file_path>#<symbolName>` identity) — used by `analyze <targetPath>`'s decision-extraction
   * anchor resolution (phase1-decision-integration.md §3b). Undefined if no row has that
   * `node_key` (e.g. a pre-STOR-005 row, or the path/symbol was never ingested).
   */
  findNodeIdByNodeKey(nodeKey: string): number | undefined;
  /**
   * Nodes with an outgoing `node_links` edge INTO `nodeId` — i.e. things that depend on/call it
   * (the 1-hop "blast radius"). Mirrors old Docuvia's `QueryService.queryIncomingEdges`. `type` is
   * the neighbor node's own kind (currently always `"module"` — every symbol/file row shares one
   * `L2NodeType`, see `persist-ast-graph.ts`); `linkType` is the actual relationship
   * (`calls`/`implements`/`extends`/`contains`/...) — the two are easy to conflate but distinct.
   * `impact`'s blast radius intentionally includes every link type here, `contains` included
   * (IMPT-001's documented single-hop heuristic); `query`'s `getContext()` is the one place that
   * filters `contains` out, since a symbol's own containing file isn't a "caller".
   */
  /**
   * Issue #135: L2 semantic coverage — how many `l2_nodes` rows carry a non-empty `description`.
   * One cheap aggregate (two `COUNT(*)`-shaped reads, no row materialization), safe to call on
   * every `doctor` invocation even against a 100k+-node graph. Tier C (the LLM enrichment pass)
   * is the writer of these descriptions; a graph where nothing is ever described is structurally
   * correct but semantically empty — exactly the "query returns empty context" failure mode
   * issue #135 documents.
   */
  getSemanticCoverage(): { totalNodes: number; describedNodes: number };
  getIncomingEdges(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string }>;
  /** Nodes `nodeId` links out to. See `getIncomingEdges()`'s doc comment on the `DISTINCT`. */
  getOutgoingEdges(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string }>;
  /**
   * `query`'s own incoming-edges lookup — same join as `getIncomingEdges()`, but per-relationship
   * rather than per-neighbor: `linkType` (`calls`/`implements`/`extends`/`contains`/...) is
   * included, and a neighbor connected by two different relationship types produces two rows
   * instead of being collapsed into one (`getIncomingEdges()`'s `DISTINCT` behavior — relied on by
   * `impact`'s blast-radius *count*, IMPT-001 — must not change). Still deduped on the full
   * (neighbor, linkType) tuple, so the exact same edge row twice is one row, not two.
   */
  getIncomingRelations(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string; linkType: string }>;
  /** Nodes `nodeId` links out to, with `linkType`. See `getIncomingRelations()`'s doc comment. */
  getOutgoingRelations(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string; linkType: string }>;
  /** Every `l2_nodes` row — used by `export-topology`. */
  getAllNodes(): L2NodeRow[];
  /** Every `node_links` row — used by `export-topology`. */
  getAllLinks(): NodeLinkRow[];
  /**
   * Rebuild-not-upsert bulk load (STOR-002 hydration): wipes `l2_nodes`/`node_links`/
   * `l2_node_l1_tags` and re-inserts `nodes`/`edges` inside a single transaction with prepared
   * statements (no ORM, no autocommit loop — the exact failure mode STOR-002 exists to prevent).
   * `nodes[].nodeKey` is the git-exported identity (STOR-005); `edges[].source`/`target`
   * reference it, not a rowid. An edge whose source/target key isn't among `nodes` is dropped
   * rather than inserted with a dangling reference (referential-integrity repair — STOR-002).
   */
  bulkLoadGraph(input: {
    projectId: number;
    nodes: Array<{ nodeKey: string; name: string; filePath?: string }>;
    edges: Array<{ source: string; target: string; type: string }>;
  }): { nodesLoaded: number; edgesLoaded: number; edgesDropped: number };
  /**
   * Deletes `node_links` rows whose `source_node_id` or `target_node_id` no longer references an
   * existing `l2_nodes` row — hygiene for the dangling rows `deleteNodesForPath` leaves behind
   * (it only deletes a deleted node's *outgoing* links; a still-live node's *incoming* link into
   * the now-gone id is left pointing nowhere). This is the "repair" half of the Tier B batch's
   * incoming-edge fix (phase1-decision-integration.md §8d, PLAT-007 Tier B): stale rows are
   * pruned here, and correct replacements are re-derived by the LSP reference pass, keyed fresh
   * by `node_key` (`findNodeIdByNodeKey`) rather than recovered from the pruned rows themselves.
   * Returns the number of rows removed.
   */
  pruneOrphanedLinks(): number;
  /**
   * Drops `l2_nodes_fts`'s sync triggers, runs `fn`, rebuilds the FTS5 index once, and recreates
   * the triggers — see `GraphNodesRepo`'s implementation doc comment. Callers that call
   * `insertNode`/`deleteNodesForPath` many times in a loop (rather than as one bulk array, which
   * `bulkLoadGraph` already handles internally) MUST wrap that loop in this, or per-row FTS5
   * tokenization dominates cost at 100k+ nodes.
   */
  withFtsSyncSuspended<T>(fn: () => T): T;
}

export interface IL3NodesRepo {
  getById(id: number): L3NodeRow | undefined;
  /**
   * Every `l3_nodes` row excluding stale/superseded decisions (`validity_status = 'garbage'`) —
   * used by `export-topology` (mirrors old Docuvia's `TopologyExportService.isExportableStatus`).
   */
  getAllExportable(): L3NodeRow[];
  /**
   * `l3_nodes` rows for a single `l2_node_id` — the "why" data behind one blast-radius/changed-
   * file node, used by `review`/`impact` to surface L3 decisions/context alongside the "what
   * changed" node list (roadmap item "Surface L3 'why' data in review/impact output").
   */
  getByL2NodeId(l2NodeId: number): L3NodeRow[];
  /**
   * Content-hash upsert for `analyze <targetPath>`'s LLM decision-extraction pipeline
   * (phase1-decision-integration.md §3c; PLAT-007 Tier C point 1), also used by the
   * `--agent-authored` write path (issue #42). `content_hash` = sha256 over
   * `nodeType + "\n" + title + "\n" + content`. When a row with the same `content_hash` already
   * exists for `projectId` (joined via `l2_nodes.project_id` — `l3_nodes` has no `project_id`
   * column of its own): bumps `occurrence_count`, refreshes `last_verified_at`, and appends
   * `commitSha` to `source_commits` if not already present — no duplicate row is inserted, and
   * `source` is left untouched (the first writer's `source` always wins, even across a later
   * call with a different `source`). Otherwise inserts a new row with `commit_hash` =
   * `commitSha`, `source_commits` = `[commitSha]`, `source` = `input.source ??
   * L3DecisionSources.ANALYZE`, `ai_generated` = 1, `validity_status` left at its column default
   * (`'pending'`).
   */
  upsertDecision(input: {
    projectId: number;
    l2NodeId: number;
    title: string;
    content: string;
    nodeType: string;
    confidence: number;
    /** HEAD sha at extraction time, or `null` on an unborn/headless HEAD (no commits yet). */
    commitSha: string | null;
    extractionModel: string | null;
    /** Workspace-relative source file paths the decision was extracted from. */
    sourceFiles: string[];
    /** `l3_nodes.source` to stamp on a fresh insert (ignored on the dedup/occurrence-bump path --
     *  an existing row keeps its original `source`, never overwritten by a later call with a
     *  different one). Defaults to `L3DecisionSources.ANALYZE` when omitted, preserving every
     *  existing caller's behavior unchanged. */
    source?: L3DecisionSource;
    /**
     * Region anchors captured at write time (issue #68) — stamped on a fresh insert only; the
     * dedup/occurrence-bump path leaves the existing row's `anchor_ranges` untouched, same
     * first-writer-wins rule as `source`. Omitted/null stores NULL ("unknown region").
     */
    anchorRanges?: L3AnchorRange[] | null;
  }): { id: number; deduped: boolean };
  /**
   * L3DIST-007's git-to-local.db import half of the union (phase2-l3-distribution.md): upserts a
   * card read off `knowledge/_l3/<content_hash>.md` on the knowledge branch, for a developer who
   * never authored it locally. Dedups by `content_hash` exactly like `upsertDecision` (joined
   * through `l2NodeId`'s project) — a `content_hash` already present locally is left untouched
   * (`imported: false`; that developer's own row is the source of truth, e.g. a richer
   * `occurrence_count`), never overwritten by the card's necessarily-thinner git-portable fields.
   * Otherwise inserts a new row seeded from the card's immutable fields, with both
   * `source_commits` and `initial_source_commits` set to the card's (already-frozen)
   * `sourceCommits`, and `created_at` preserved from the card rather than stamped "now" — the
   * imported row's history should read as the original decision's, not this machine's import
   * time. Fields the card deliberately never carries (L3DIST-003: `occurrence_count`,
   * `last_verified_at`, `confidence`, `noise_score`, `validity_status`, `commit_hash`,
   * `introduced_in_commit`, `verified_until_commit`) are left at their column defaults.
   */
  importCard(input: {
    l2NodeId: number;
    contentHash: string;
    title: string;
    content: string;
    nodeType: string;
    sourceCommits: string[];
    extractionModel: string | null;
    sourceFiles: string[];
    createdAt: string;
  }): { id: number; imported: boolean };
  /**
   * Flips one row's `validity_status` (issue #68's validity pass): `pending -> active` when the
   * row's region anchors still blame back to one of its own source commits, and
   * `* -> 'garbage'` ("dead/superseded") when blame shows the writing commit no longer owns the
   * lines it describes. A no-op when the row already carries `status`.
   */
  updateValidityStatus(id: number, status: ValidityStatus): void;
}

export interface IFtsRepo {
  /**
   * FTS5 keyword search over `l2_nodes` (name/description/path_patterns), ranked by `rank`.
   * Returns full mapped rows, not the fts5 virtual table's own shape.
   */
  searchL2Nodes(keywords: string[], limit: number): L2NodeRow[];
  /** FTS5 keyword search over `l3_nodes` (title/content), ranked by `rank`. */
  searchL3Nodes(keywords: string[], limit: number): L3NodeRow[];
}

export interface AstCallSiteRow {
  id: number;
  project_id: number;
  file_path: string;
  target_function: string;
  start_line: number;
  start_column: number;
  created_at: string;
}

export interface ICallSitesRepo {
  /** Deletes all call-site rows for one file (mirrors IGraphNodesRepo.deleteNodesForPath's
   *  delete-then-reinsert-on-reparse pattern) -- called by GraphPersisterService before
   *  re-inserting a re-parsed file's fresh call sites. */
  deleteForFile(projectId: number, filePath: string): void;
  /** Bulk-inserts one file's call sites in one prepared-statement loop (same rationale as
   *  GraphPersisterService's insertFunctionNodes/insertClassNodes -- avoid per-row overhead
   *  at vscode/nest scale). No-op on an empty array. */
  insertMany(
    projectId: number,
    filePath: string,
    callSites: Array<{
      targetFunction: string;
      startLine: number;
      startColumn: number;
    }>,
  ): void;
  /** Tier B's read-back (issue #11 plan A, Slice 3): every persisted call site for the given
   *  files, keyed by the *exact* relativePath string passed in (D4) -- callers must not expect
   *  path normalization here. Files with no rows (never parsed, or parsed with zero calls) are
   *  simply absent from the returned map, not present with an empty array, so callers can use
   *  Map.has()/`in` to distinguish "no data" from "confirmed zero calls" if that distinction
   *  ever matters later. */
  getForFiles(
    projectId: number,
    filePaths: string[],
  ): Map<
    string,
    Array<{ targetFunction: string; startLine: number; startColumn: number }>
  >;
}

/**
 * The shared memory/state layer surface — implemented by `lib/schema`'s `GraphStore`. One
 * instance per `dbPath` per process, opened and closed exclusively by the Orchestration layer
 * (`lib/ui-core`); no other layer manages its lifecycle.
 */
export interface IGraphStore {
  readonly projects: IProjectsRepo;
  readonly files: IProjectFilesRepo;
  readonly tags: ITagsRepo;
  readonly graph: IGraphNodesRepo;
  readonly l3: IL3NodesRepo;
  readonly fts: IFtsRepo;
  readonly meta: IMetaRepo;
  readonly callSites: ICallSitesRepo;
  withWriteLock<T>(fn: () => Promise<T> | T): Promise<T>;
  withReadLock<T>(fn: () => Promise<T> | T): Promise<T>;
  /**
   * Runs `fn` inside a single `better-sqlite3` transaction (one BEGIN/COMMIT, rolled back on
   * throw) instead of each repo call inside it auto-committing on its own. `fn` must be fully
   * synchronous — SQLite transactions can't span an event-loop turn — matching every existing
   * `IGraphNodesRepo`/`IProjectFilesRepo`/etc. method, which are already sync. Callers writing
   * many rows in one logical operation (e.g. `GraphPersisterService.persistLocked`) MUST use this
   * instead of relying on default autocommit: at vscode-repo scale (12k+ files, hundreds of
   * thousands of `calls`/`extends`/`implements` edges once `ScopeResolver` actually resolves
   * them), one fsync per row turned a multi-minute persist into a practically-infinite one — see
   * docs/cli-test-analysis/typescript-cli-benchmark.md's Tier B re-verification session. Does not
   * replace `withWriteLock` — callers still need that for cross-process/cross-call serialization;
   * this only removes the per-statement autocommit cost inside one already-locked call.
   */
  withTransaction<T>(fn: () => T): T;
  close(): Promise<void>;
  /**
   * Surgically removes `project_files`/`l2_nodes` (and their `node_links`/`l2_node_l1_tags`) for
   * files no longer present in `activeFiles`, in a single transaction — without wiping the whole
   * database. A node is stale when none of its `path_patterns` entries are in `activeFiles`
   * (mirrors old Docuvia's `CleanService.prune`, adapted to this schema's `path_patterns` column
   * instead of the old `source_paths` column). Not currently wired to any workflow/CLI command —
   * old Docuvia never called it from a command either (see `docs/gitbook/analysis/data-pipeline-sync.md`);
   * it is exposed here so a future incremental-sync workflow can use it.
   */
  pruneMissingFiles(activeFiles: string[]): {
    prunedFiles: number;
    prunedNodes: number;
  };
}

export interface GraphStoreOpenOptions {
  dbPath: string;
  readonly?: boolean;
}
