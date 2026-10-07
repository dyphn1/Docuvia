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

export interface ProjectFileSnapshotMetadata {
  filePath: string;
  contentHash: string | null;
  lastTierBProcessedAt: string | null;
  lastTierBCommitSha: string | null;
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
  LEXICAL_PARENT: "lexical_parent",
  LEXICAL_OWNER: "lexical_owner",
  CALLS: "calls",
  IMPLEMENTS: "implements",
  EXTENDS: "extends",
  IMPORTS: "imports",
  DEPENDS_ON: "depends_on",
  DECISION: "decision",
} as const;
export type LinkType = (typeof LinkTypes)[keyof typeof LinkTypes];

/** Relationships that describe graph structure rather than dependency edges. */
export const StructuralLinkTypes: readonly string[] = [
  LinkTypes.CONTAINS,
  LinkTypes.LEXICAL_PARENT,
  LinkTypes.LEXICAL_OWNER,
];

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
  /** Deletes one key when restoring a snapshot that predates a capability. Optional for
   *  compatibility with alternate providers; callers must fail closed when it is absent. */
  delete?(key: string): void;
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
  /**
   * Snapshot-facing bulk read of persisted file metadata. One row per project_files record,
   * including the Tier-B processed marker needed to reconstruct coverage after hydrate.
   */
  getAllSnapshotMetadata(): ProjectFileSnapshotMetadata[];
  upsertFile(input: {
    projectId: number;
    filePath: string;
    contentHash: string | null;
  }): void;
  /**
   * Issue #508 Phase 3 (D6/D11): removes the `project_files` row of a path that left the tree
   * (deleted, or the old side of a rename), keyed on (project_id, file_path). A missing row is a
   * no-op. Without it the row outlived its file: it kept counting toward Tier B coverage, stayed a
   * #393 dynamic-import candidate, and let the full-ingestion hash diff skip a later re-add.
   */
  deleteFile(projectId: number, filePath: string): void;
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
    /** Optional persisted timestamp used only when restoring snapshot metadata. */
    processedAt?: string;
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

/**
 * Issue #508 Phase 3 (D9): one incoming `node_links` row into a node of a file being re-parsed,
 * whose source node lives in a file *outside* the re-parse batch. Keyed by the target's STOR-005
 * `node_key` (not its rowid, which the per-file replace reassigns) so Tier A can re-attach it.
 */
export interface ExternalIncomingLink {
  sourceNodeId: number;
  targetNodeKey: string;
  linkType: string;
}

export interface IGraphNodesRepo {
  /**
   * Deletes every `l2_nodes` row for `filePath` together with its `l2_node_l1_tags` rows and
   * every `node_links` row that touches a deleted id -- outgoing *and* incoming (#508 Phase 3
   * D9), so the delete never leaves a dangling row behind. A caller that re-parses the file and
   * wants to keep incoming edges from unchanged files captures them first with
   * `getExternalIncomingLinks` and re-attaches them by `node_key` after the re-insert (Tier A's
   * per-file replace, PLAT-007). Returns the deleted node ids.
   */
  deleteNodesForPath(filePath: string): number[];
  /**
   * Issue #508 Phase 3 (D9): dependency `node_links` rows (`contains` and v2 lexical context
   * excluded) into the nodes of `filePaths` whose source node belongs to a file outside
   * `filePaths`, deduplicated. Target
   * nodes are found through the `node_key` index (`<path>` and `<path>#...`) and sources through
   * `node_links.target_node_id`'s index -- no full scan of `l2_nodes`, so it is safe per re-parse
   * batch at 100k+ nodes. Rows with no `node_key` (pre-STOR-005) are not returned.
   */
  getExternalIncomingLinks(
    filePaths: readonly string[],
  ): ExternalIncomingLink[];
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
  findNodeByName(target: string):
    | {
        id: number;
        name: string;
        type: string;
        filePath?: string;
      }
    | undefined;
  /** Exact exported node identity for a row id, optional for alternate graph providers. */
  getNodeKeyById?(nodeId: number): string | undefined;
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
   * The neighbor set includes file ownership (`contains`) as impact context (IMPT-001's
   * documented single-hop heuristic), but omits `lexical_parent` and `lexical_owner`; the
   * versioned impact walk reads those relationships through `getIncomingRelations()`.
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
  /**
   * Issue #221 P3: a small deterministic sample of non-empty `l2_nodes` names (`ORDER BY id`,
   * primary-key ordered, so no full scan) feeding `doctor`'s canary self-test — the exact-name
   * lookup and FTS-sync assertions need real, known-present names without materializing every
   * row of a 100k+-node graph (`getAllNodes()`'s job, too heavy here).
   */
  getCanarySample(limit: number): Array<{ name: string }>;
  getIncomingEdges(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string }>;
  /** Nodes `nodeId` links out to, excluding v2 lexical context links. */
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
   * existing `l2_nodes` row. Until #508 Phase 3 (D9) `deleteNodesForPath` deleted only a node's
   * *outgoing* links, leaving every still-live node's *incoming* link into the gone id pointing
   * nowhere; it now deletes both directions and Tier A re-attaches external incoming edges by
   * `node_key`, so no current path creates such rows. This remains the Tier B batch's hygiene
   * pass (phase1-decision-integration.md §8d, PLAT-007 Tier B) for databases written before that
   * fix; LSP-precision replacements are still re-derived by the reference pass, keyed fresh by
   * `node_key` (`findNodeIdByNodeKey`). Returns the number of rows removed.
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
  /** Terminal callee identifier (`"doSomething"` of `"service.doSomething"`), issue #192's
   *  name-based-resolution evidence column. NULL on pre-0012 rows. */
  callee_name: string | null;
  /** Receiver expression text (`"service"`, `"this.logger"`). NULL for bare calls. */
  receiver_text: string | null;
  /** Shape classifier: 'bare' | 'member' | 'this' | 'arg-chain' | 'computed'. NULL = unknown. */
  callee_kind: string | null;
}

/** Project-portable call-site data exported in a knowledge snapshot. It deliberately excludes
 *  SQLite row ids and project ids, which are local to each clone. */
export interface SnapshotCallSiteRow {
  filePath: string;
  targetFunction: string;
  startLine: number;
  startColumn: number;
  calleeName: string | null;
  receiverText: string | null;
  calleeKind: string | null;
}

export interface ICallSitesRepo {
  /** Deletes all call-site rows for one file (mirrors IGraphNodesRepo.deleteNodesForPath's
   *  delete-then-reinsert-on-reparse pattern) -- called by GraphPersisterService before
   *  re-inserting a re-parsed file's fresh call sites. */
  deleteForFile(projectId: number, filePath: string): void;
  /** Bulk-inserts one file's call sites in one prepared-statement loop (same rationale as
   *  GraphPersisterService's insertFunctionNodes/insertClassNodes -- avoid per-row overhead
   *  at vscode/nest scale). No-op on an empty array. The decomposition fields (issue #192) are
   *  optional evidence columns -- absent/undefined inserts NULL, matching pre-0012 rows. */
  insertMany(
    projectId: number,
    filePath: string,
    callSites: Array<{
      targetFunction: string;
      startLine: number;
      startColumn: number;
      calleeName?: string;
      receiverText?: string;
      calleeKind?: string;
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
  /** Issue #217's impact fallback read-back -- the reverse of `getForFiles`: every persisted
   *  call site whose `target_function` OR (issue #192) `callee_name` is one of
   *  `targetFunctions`, keyed by the calling file's exact relativePath (same
   *  no-normalization/no-empty-array convention as `getForFiles`). This is what surfaces
   *  dependents ScopeResolver could never resolve into a `node_links` edge (runtime-variable
   *  plugin paths, computed `import()` specifiers, member calls whose receiver defeated bare-name
   *  matching, ...): the call site row exists even though the edge doesn't. Returns an empty map
   *  without touching the database when `targetFunctions` is empty. */
  getByTargetFunctions(
    projectId: number,
    targetFunctions: string[],
  ): Map<string, Array<{ startLine: number; startColumn: number }>>;
  /** Stable, project-portable snapshot read, ordered by every exported field. Optional so older
   *  alternate providers can still run; snapshot packing omits the capability when absent. */
  getAllForProject?(projectId: number): SnapshotCallSiteRow[];
  /** Replaces the project's complete call-site set during hydration. Optional for older
   *  providers; hydration marks the capability unavailable when it is not implemented. */
  replaceForProject?(projectId: number, callSites: SnapshotCallSiteRow[]): void;
}

export const CallSiteResolutionClasses = {
  PROVEN: "proven",
  LIKELY: "likely",
  AMBIGUOUS: "ambiguous",
  UNRESOLVED: "unresolved",
  EXTERNAL: "external",
  UNSUPPORTED: "unsupported",
} as const;
export type CallSiteResolutionClass =
  (typeof CallSiteResolutionClasses)[keyof typeof CallSiteResolutionClasses];

/** Tier B response tied to an exact stored site, source snapshot and selected target. Results that
 *  do not name exactly one local definition never carry a target node key. */
export type CallSiteLspResolutionResult =
  | {
      callSiteKey: string;
      sourceContentHash: string;
      ruleSignature: string;
      verificationPolicyVersion: string;
      expectedTargetNodeKey: string | null;
      resolutionClass: CallSiteResolutionClass;
      verificationMode: "tier-b" | "canary";
      outcome: "unique-local";
      targetNodeKey: string;
    }
  | {
      callSiteKey: string;
      sourceContentHash: string;
      ruleSignature: string;
      verificationPolicyVersion: string;
      expectedTargetNodeKey: string | null;
      resolutionClass: CallSiteResolutionClass;
      verificationMode: "tier-b" | "canary";
      outcome: "no-result" | "timeout" | "external" | "multi-location";
    };

export const CallSiteRuleQuarantineReasons = {
  TIER_B_TARGET_MISMATCH: "tier-b-target-mismatch",
} as const;

export interface CallSiteRuleQuarantine {
  ruleSignature: string;
  policyVersion: string;
  reason: (typeof CallSiteRuleQuarantineReasons)[keyof typeof CallSiteRuleQuarantineReasons];
  callSiteKey: string;
  sourceContentHash: string;
  expectedTargetNodeKey: string;
  observedTargetNodeKey: string;
  /** Null only for rows created before migration 0018 or by legacy callers without a hash. */
  ruleConfigurationSha256: string | null;
  createdAt: string;
}

export type CallSiteRuleQuarantineClearEvidence =
  | {
      kind: "certification";
      evidenceSha256: string;
      resultsRecordedAt: string;
    }
  | {
      kind: "operator";
      operator: string;
      reason: string;
    };

export interface CallSiteRuleQuarantineClearRequest {
  newRuleConfigurationSha256: string;
  evidence: CallSiteRuleQuarantineClearEvidence;
}

export interface CallSiteRuleQuarantineClearAudit {
  id: number;
  ruleSignature: string;
  quarantinePolicyVersion: string;
  quarantineReason: CallSiteRuleQuarantine["reason"];
  quarantineCallSiteKey: string;
  quarantineSourceContentHash: string;
  expectedTargetNodeKey: string;
  observedTargetNodeKey: string;
  quarantineCreatedAt: string;
  clearedAt: string;
  method: CallSiteRuleQuarantineClearEvidence["kind"];
  evidenceSha256: string | null;
  operator: string | null;
  reason: string | null;
  previousRuleConfigurationSha256: string;
  newRuleConfigurationSha256: string;
}

export type CallSiteRuleQuarantineClearResult =
  | { status: "cleared"; audit: CallSiteRuleQuarantineClearAudit }
  | { status: "already-cleared"; audit: CallSiteRuleQuarantineClearAudit };

export type CallResolutionQuarantineClearEvidenceInput =
  | {
      kind: "operator";
      operator: string;
      reason: string;
    }
  | {
      kind: "certification";
      artifact: string;
      trustedInputsJson: string;
    };

export interface CallResolutionQuarantineListResult {
  currentRuleConfigurationSha256: string;
  active: CallSiteRuleQuarantine[];
  clearAudits: CallSiteRuleQuarantineClearAudit[];
}

export interface CallSiteVerificationApplyResult {
  updatedCallSiteKeys: string[];
  affectedFilePaths: string[];
  quarantinedRuleSignatures: string[];
}

export const CallSiteVerificationStatuses = {
  UNVERIFIED: "unverified",
  VERIFIED: "verified",
  CONTRADICTED: "contradicted",
} as const;
export type CallSiteVerificationStatus =
  (typeof CallSiteVerificationStatuses)[keyof typeof CallSiteVerificationStatuses];

export const CALL_SITE_VERIFICATION_POLICY_VERSION =
  "sha256-callsite-rule-v2" as const;

export const CallSiteResolutionObservationSources = {
  SCOPE_RESOLVER: "scope-resolver",
  STRICT_PROOF: "strict-proof",
  HYPOTHESIS: "hypothesis",
  TIER_B: "tier-b",
} as const;
export type CallSiteResolutionObservationSource =
  (typeof CallSiteResolutionObservationSources)[keyof typeof CallSiteResolutionObservationSources];

export interface CallSiteResolutionCandidate {
  targetNodeKey: string;
  ordinal: number;
  evidenceJson: string;
}

/** File inputs whose hashes contributed to the current resolution's dependency fingerprint. */
export interface CallSiteResolutionDependency {
  filePath: string;
  contentHash: string | null;
}

/** Caller files whose collapsed calls projections were rebuilt by an atomic invalidation pass. */
export interface CallSiteResolutionInvalidationResult {
  invalidatedCount: number;
  affectedFilePaths: string[];
}

/** Current content-scoped resolution for one call site. Candidates are normalized separately. */
export interface CallSiteResolutionRecord {
  callSiteKey: string;
  identityVersion: 1;
  filePath: string;
  sourceContentHash: string;
  startLine: number;
  startColumn: number;
  calleeKind: string;
  calleeName: string;
  callerNodeKey: string;
  resolutionClass: CallSiteResolutionClass;
  selectedTargetNodeKey: string | null;
  confidence: number | null;
  resolver: string;
  ruleSignature: string;
  dependencyFingerprint: string;
  dependencies: CallSiteResolutionDependency[];
  verificationStatus: CallSiteVerificationStatus;
  /** Unique local target observed by Tier B when status is verified or contradicted. */
  verifiedTargetNodeKey: string | null;
  isStale: boolean;
  candidates: CallSiteResolutionCandidate[];
}

/** Project-portable current resolution state. The ScopeResolver projection owner is kept
 * separately from the enclosing caller so a hydrated row can preserve future invalidation
 * behavior without exporting SQLite ids or local quarantine state. */
export interface SnapshotCallResolutionRow extends CallSiteResolutionRecord {
  projectionCallerNodeKey: string | null;
}

/** ScopeResolver's caller node for the derived `calls` projection. This stays separate from the
 *  exact enclosing caller identity stored in `CallSiteResolutionRecord.callerNodeKey`. */
export interface CallSiteResolutionProjectionCallerInput {
  callSiteKey: string;
  callerNodeKey: string;
}

export interface CallSiteResolutionObservationInput {
  callSiteKey: string;
  filePath: string;
  sourceContentHash: string;
  source: CallSiteResolutionObservationSource;
  targetNodeKey: string | null;
  evidenceJson: string;
  resolutionClass?: CallSiteResolutionClass | null;
  resolver?: string | null;
  ruleSignature?: string | null;
}

export interface CallSiteResolutionObservation extends CallSiteResolutionObservationInput {
  id: number;
  createdAt: string;
}

export interface ICallSiteResolutionsRepo {
  /** Atomically replaces current resolutions and candidates for one caller file. */
  replaceForFile(
    projectId: number,
    filePath: string,
    resolutions: CallSiteResolutionRecord[],
    projectionCallers?: CallSiteResolutionProjectionCallerInput[],
  ): void;
  /** Deletes current per-site resolutions and derived candidates for one file, retaining history. */
  deleteForFile(projectId: number, filePath: string): void;
  /** Returns current resolutions in portable-key order, with ordinal-ordered candidates. */
  getForFile(projectId: number, filePath: string): CallSiteResolutionRecord[];
  /** Stable portable read for snapshot packing. Optional for alternate providers. */
  getAllForProject?(projectId: number): SnapshotCallResolutionRow[];
  /** Replaces portable current state without rebuilding graph edges during hydration. */
  replaceForProject?(
    projectId: number,
    resolutions: SnapshotCallResolutionRow[],
  ): void;
  /** Applies site-bound Tier B responses and atomically rebuilds affected calls projections. */
  applyTierBVerificationResults(
    projectId: number,
    results: CallSiteLspResolutionResult[],
    ruleConfigurationSha256?: string,
  ): CallSiteVerificationApplyResult;
  /** Locally quarantined signatures survive batches and force future replacement rows to Tier B. */
  getQuarantinedRuleSignatures(projectId: number): string[];
  /** Local-only quarantine evidence; excluded from portable snapshots. */
  getRuleQuarantines(projectId: number): CallSiteRuleQuarantine[];
  /** Immutable local history for explicit quarantine clears. */
  getRuleQuarantineClearAudits(
    projectId: number,
  ): CallSiteRuleQuarantineClearAudit[];
  /** Clears an active quarantine only after a newer, changed configuration is evidenced. */
  clearRuleQuarantine(
    projectId: number,
    ruleSignature: string,
    request: CallSiteRuleQuarantineClearRequest,
  ): CallSiteRuleQuarantineClearResult;
  /** Marks current resolutions stale when a dependency's observed hash differs from current content. */
  invalidateChangedDependencies(
    projectId: number,
    changedDependencies: CallSiteResolutionDependency[],
  ): CallSiteResolutionInvalidationResult;
  /** Marks every current resolution stale before a full graph replacement or hydration. */
  invalidateAll(projectId: number): CallSiteResolutionInvalidationResult;
  /** Appends immutable resolver/proof/ranking/Tier B evidence for a call site. */
  appendObservation(
    projectId: number,
    observation: CallSiteResolutionObservationInput,
  ): void;
  /** Returns all history for the caller file, including observations for prior source versions. */
  getObservations(
    projectId: number,
    filePath: string,
  ): CallSiteResolutionObservation[];
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
  /** Optional while alternate GraphStore providers migrate to per-call-site resolution storage. */
  readonly callSiteResolutions?: ICallSiteResolutionsRepo;
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
   * replace `withWriteLock` — callers still need that for in-process cross-call serialization.
   *
   * The transaction is a write transaction (`BEGIN IMMEDIATE`): it takes SQLite's write lock up
   * front, waiting on `busy_timeout` if another process holds it. That is the cross-process
   * coordination — `withWriteLock` is process-local. A deferred BEGIN would take a read snapshot
   * on the first SELECT and fail with SQLITE_BUSY_SNAPSHOT (no busy wait) at the first write if
   * another process committed in between (issue #480). Do not use it for read-only work.
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
