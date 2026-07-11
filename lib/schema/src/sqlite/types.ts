/**
 * Hand-written row interfaces for the local SQLite schema, matching
 * migrations/0001_init.sql's column set exactly (types, nullability).
 *
 * Numeric booleans (SQLite has no native boolean type) are typed as
 * `0 | 1` rather than `boolean` since that's what better-sqlite3 hands back
 * from `.get()`/`.all()` without an explicit conversion layer.
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
