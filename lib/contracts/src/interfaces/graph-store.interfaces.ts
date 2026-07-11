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
}

export interface IProjectsRepo {
  getFirst(): ProjectRow | undefined;
  insert(input: { name: string; repoUrl: string }): ProjectRow;
}

export interface IProjectFilesRepo {
  getAllHashes(): Array<{ filePath: string; contentHash: string | null }>;
  upsertFile(input: { projectId: number; filePath: string; contentHash: string | null }): void;
}

export interface ITagsRepo {
  upsertTag(name: string): void;
  getIdByName(name: string): number | undefined;
  linkNodeToTag(l2NodeId: number, l1TagId: number): void;
}

export interface IGraphNodesRepo {
  deleteNodesForPath(filePath: string): number[];
  insertNode(input: {
    projectId: number;
    name: string;
    type?: string;
    description?: string;
    pathPatterns: string[];
  }): number;
  insertLink(input: { sourceNodeId: number; targetNodeId: number; linkType: string }): void;
  findNodeIdByName(filePath: string, name: string): number | undefined;
}

export interface IFtsRepo {}

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
  readonly fts: IFtsRepo;
  withWriteLock<T>(fn: () => Promise<T> | T): Promise<T>;
  withReadLock<T>(fn: () => Promise<T> | T): Promise<T>;
  close(): Promise<void>;
}

export interface GraphStoreOpenOptions {
  dbPath: string;
  readonly?: boolean;
}
