/**
 * Row shapes for the local SQLite schema (see `lib/schema`'s migrations). Defined here, not in
 * `lib/schema`, per the Virtual Contracts "Mandatory Mapping" rule — `lib/schema` must map its
 * raw driver output onto these before returning from any repo method; nothing above this layer
 * may depend on `lib/schema` types directly. Numeric booleans (SQLite has no native boolean
 * type) are typed as `0 | 1`, matching what `better-sqlite3` hands back without an explicit
 * conversion layer.
 */
export interface ProjectRow {
  id: number;
  name: string;
  repo_url: string;
  description: string | null;
  status: string;
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

export interface L2NodeRow {
  id: number;
  project_id: number;
  name: string;
  type: string;
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

export interface NodeLinkRow {
  id: number;
  source_node_id: number;
  target_node_id: number;
  link_type: string;
  commit_sha: string | null;
  diff_summary: string | null;
  created_at: string;
}

export interface L2NodeL1TagRow {
  l2_node_id: number;
  l1_tag_id: number;
  created_at: string;
}

export interface L3NodeRow {
  id: number;
  l2_node_id: number;
  title: string;
  content: string | null;
  node_type: string;
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
  validity_status: string;
  source: string;
  content_hash: string | null;
  /** LLM model id used for extraction (e.g. `gpt-4o-mini`) — null on rows inserted before this column existed, or when the extraction path never set it. */
  extraction_model: string | null;
  /** JSON array of workspace-relative source file paths the decision was extracted from — null on rows inserted before this column existed. */
  source_files: string | null;
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
   * `QueryService.findNodeByName`). Undefined when nothing matches either way.
   */
  findNodeByName(
    target: string,
  ): { id: number; name: string; type: string } | undefined;
  /**
   * Resolves an l2_node's id by its exact STOR-005 `node_key` (deterministic `<file_path>` /
   * `<file_path>#<symbolName>` identity) — used by `analyze <targetPath>`'s decision-extraction
   * anchor resolution (phase1-decision-integration.md §3b). Undefined if no row has that
   * `node_key` (e.g. a pre-STOR-005 row, or the path/symbol was never ingested).
   */
  findNodeIdByNodeKey(nodeKey: string): number | undefined;
  /**
   * Nodes with an outgoing `node_links` edge INTO `nodeId` — i.e. things that depend on/call it
   * (the 1-hop "blast radius"). Mirrors old Docuvia's `QueryService.queryIncomingEdges`.
   */
  getIncomingEdges(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string }>;
  /** Nodes `nodeId` links out to (used by `query`'s structural context). */
  getOutgoingEdges(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string }>;
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
}

export interface IL3NodesRepo {
  getById(id: number): L3NodeRow | undefined;
  /**
   * Every `l3_nodes` row excluding stale/superseded decisions (`validity_status = 'garbage'`) —
   * used by `export-topology` (mirrors old Docuvia's `TopologyExportService.isExportableStatus`).
   */
  getAllExportable(): L3NodeRow[];
  /**
   * Content-hash upsert for `analyze <targetPath>`'s LLM decision-extraction pipeline
   * (phase1-decision-integration.md §3c; PLAT-007 Tier C point 1). `content_hash` = sha256 over
   * `nodeType + "\n" + title + "\n" + content`. When a row with the same `content_hash` already
   * exists for `projectId` (joined via `l2_nodes.project_id` — `l3_nodes` has no `project_id`
   * column of its own): bumps `occurrence_count`, refreshes `last_verified_at`, and appends
   * `commitSha` to `source_commits` if not already present — no duplicate row is inserted.
   * Otherwise inserts a new row with `commit_hash` = `commitSha`, `source_commits` =
   * `[commitSha]`, `source` = `'analyze'`, `ai_generated` = 1, `validity_status` left at its
   * column default (`'pending'`).
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
  }): { id: number; deduped: boolean };
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
  withWriteLock<T>(fn: () => Promise<T> | T): Promise<T>;
  withReadLock<T>(fn: () => Promise<T> | T): Promise<T>;
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
