import type Database from "better-sqlite3";
import type {
  CallResolutionFunctionNodeReference,
  CallResolutionHypothesisSourceFile,
  CallResolutionSourceIndexRead,
  IProjectFilesRepo,
  ProjectFileRow,
  ProjectFileSnapshotMetadata,
} from "@workspace/contracts";
import {
  CALL_RESOLUTION_SOURCE_INDEX_SCHEMA_VERSION,
  type PersistedCallResolutionSourceFile,
} from "@workspace/contracts";
import { SchemaTables, SchemaColumns } from "../constants.js";

/** `files` repo — `project_files` reads/writes for the file-discovery hash-diff. */
export class ProjectFilesRepo implements IProjectFilesRepo {
  constructor(private readonly db: Database.Database) {}

  /**
   * Reads path + content-hash pairs for every tracked file. Used by file discovery to diff
   * on-disk hashes against last-known hashes and decide which files need (re-)parsing. Returns
   * an empty array on a fresh workspace (no rows yet).
   */
  getAllHashes(): Array<{ filePath: string; contentHash: string | null }> {
    const rows = this.db
      .prepare(
        `SELECT ${SchemaColumns.FILE_PATH}, ${SchemaColumns.CONTENT_HASH} FROM ${SchemaTables.PROJECT_FILES}`,
      )
      .all() as Pick<ProjectFileRow, "file_path" | "content_hash">[];
    return rows.map((row) => ({
      filePath: row.file_path,
      contentHash: row.content_hash,
    }));
  }

  /** One deterministic bulk read for snapshot/hydrate metadata round-tripping. */
  getAllSnapshotMetadata(): ProjectFileSnapshotMetadata[] {
    const rows = this.db
      .prepare(
        `SELECT ${SchemaColumns.FILE_PATH}, ${SchemaColumns.CONTENT_HASH},
                last_tier_b_processed_at, last_tier_b_commit_sha
         FROM ${SchemaTables.PROJECT_FILES}
         ORDER BY ${SchemaColumns.FILE_PATH}`,
      )
      .all() as Pick<
      ProjectFileRow,
      | "file_path"
      | "content_hash"
      | "last_tier_b_processed_at"
      | "last_tier_b_commit_sha"
    >[];

    return rows.map((row) => ({
      filePath: row.file_path,
      contentHash: row.content_hash,
      lastTierBProcessedAt: row.last_tier_b_processed_at,
      lastTierBCommitSha: row.last_tier_b_commit_sha,
    }));
  }

  /** Upserts a file's content hash after (re-)parsing, keyed on (project_id, file_path). */
  upsertFile(input: {
    projectId: number;
    filePath: string;
    contentHash: string | null;
    sourceIndexFile?: CallResolutionHypothesisSourceFile;
    sourceIndexFunctionNodeReferences?: readonly CallResolutionFunctionNodeReference[];
    sourceIndexResolverLocalSymbols?: readonly string[];
  }): void {
    const sourceIndexJson = input.sourceIndexFile
      ? JSON.stringify({
          schemaVersion: CALL_RESOLUTION_SOURCE_INDEX_SCHEMA_VERSION,
          sourceFile: input.sourceIndexFile,
          functionNodeReferences:
            input.sourceIndexFunctionNodeReferences ?? null,
          resolverLocalSymbols: input.sourceIndexResolverLocalSymbols ?? null,
        } satisfies Omit<
          PersistedCallResolutionSourceFile,
          "functionNodeReferences" | "resolverLocalSymbols"
        > & {
          functionNodeReferences:
            readonly CallResolutionFunctionNodeReference[] | null;
          resolverLocalSymbols: readonly string[] | null;
        })
      : null;
    this.db
      .prepare(
        `INSERT INTO ${SchemaTables.PROJECT_FILES} (${SchemaColumns.PROJECT_ID}, ${SchemaColumns.FILE_PATH}, ${SchemaColumns.CONTENT_HASH}, last_parsed_at, ${SchemaColumns.SOURCE_INDEX_JSON})
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT(${SchemaColumns.PROJECT_ID}, ${SchemaColumns.FILE_PATH})
         DO UPDATE SET ${SchemaColumns.CONTENT_HASH} = excluded.${SchemaColumns.CONTENT_HASH}, last_parsed_at = CURRENT_TIMESTAMP,
           ${SchemaColumns.SOURCE_INDEX_JSON} = COALESCE(excluded.${SchemaColumns.SOURCE_INDEX_JSON}, ${SchemaTables.PROJECT_FILES}.${SchemaColumns.SOURCE_INDEX_JSON})`,
      )
      .run(input.projectId, input.filePath, input.contentHash, sourceIndexJson);
  }

  clearCallResolutionSourceFiles(projectId: number): void {
    this.db
      .prepare(
        `UPDATE ${SchemaTables.PROJECT_FILES} SET ${SchemaColumns.SOURCE_INDEX_JSON} = NULL WHERE ${SchemaColumns.PROJECT_ID} = ?`,
      )
      .run(projectId);
  }

  getCallResolutionSourceFiles(
    projectId: number,
  ): CallResolutionSourceIndexRead {
    const rows = this.db
      .prepare(
        `SELECT ${SchemaColumns.FILE_PATH}, ${SchemaColumns.SOURCE_INDEX_JSON} FROM ${SchemaTables.PROJECT_FILES} WHERE ${SchemaColumns.PROJECT_ID} = ? ORDER BY ${SchemaColumns.FILE_PATH}`,
      )
      .all(projectId) as Pick<
      ProjectFileRow,
      "file_path" | "source_index_json"
    >[];
    const sourceFiles: CallResolutionHypothesisSourceFile[] = [];
    const functionNodeReferencesByFile: {
      filePath: string;
      functionNodeReferences: readonly CallResolutionFunctionNodeReference[];
    }[] = [];
    const resolverLocalSymbolsByFile: {
      filePath: string;
      localSymbols: readonly string[];
    }[] = [];
    const incompleteFilePaths: string[] = [];

    for (const row of rows) {
      const persistedSourceFile = parsePersistedSourceFile(
        row.file_path,
        row.source_index_json,
      );
      if (!persistedSourceFile) {
        incompleteFilePaths.push(row.file_path);
        continue;
      }
      sourceFiles.push(persistedSourceFile.sourceFile);
      functionNodeReferencesByFile.push({
        filePath: row.file_path,
        functionNodeReferences: persistedSourceFile.functionNodeReferences,
      });
      resolverLocalSymbolsByFile.push({
        filePath: row.file_path,
        localSymbols: persistedSourceFile.resolverLocalSymbols,
      });
    }

    return {
      sourceFiles,
      functionNodeReferencesByFile,
      resolverLocalSymbolsByFile,
      complete: incompleteFilePaths.length === 0,
      incompleteFilePaths,
    };
  }

  /** Removes one path's row (see `IProjectFilesRepo.deleteFile`, #508 D6/D11). */
  deleteFile(projectId: number, filePath: string): void {
    this.db
      .prepare(
        `DELETE FROM ${SchemaTables.PROJECT_FILES} WHERE ${SchemaColumns.PROJECT_ID} = ? AND ${SchemaColumns.FILE_PATH} = ?`,
      )
      .run(projectId, filePath);
  }

  /**
   * Stamps a file's `last_tier_b_processed_at`/`last_tier_b_commit_sha` after Tier B (re)computes
   * its calls-edges, keyed on (project_id, file_path) — mirrors `upsertFile()`'s own upsert shape
   * exactly. Upserts defensively: a matching row should already exist from Tier A parsing, but a
   * missing one must not silently no-op.
   */
  markTierBProcessed(input: {
    projectId: number;
    filePath: string;
    commitSha: string | null;
    processedAt?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO ${SchemaTables.PROJECT_FILES} (${SchemaColumns.PROJECT_ID}, ${SchemaColumns.FILE_PATH}, last_tier_b_processed_at, last_tier_b_commit_sha)
         VALUES (?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
         ON CONFLICT(${SchemaColumns.PROJECT_ID}, ${SchemaColumns.FILE_PATH})
         DO UPDATE SET last_tier_b_processed_at = excluded.last_tier_b_processed_at, last_tier_b_commit_sha = excluded.last_tier_b_commit_sha`,
      )
      .run(
        input.projectId,
        input.filePath,
        input.processedAt ?? null,
        input.commitSha,
      );
  }

  /**
   * Tier B processed-at/commit-sha for a single file, keyed by `file_path` alone (matches how
   * `query`/`impact` resolve a node's own file — they don't carry a `project_id` at that point).
   * Undefined when there's no `project_files` row for `filePath` at all.
   */
  getTierBFileStatus(
    filePath: string,
  ):
    | { lastProcessedAt: string | null; lastProcessedCommitSha: string | null }
    | undefined {
    const row = this.db
      .prepare(
        `SELECT last_tier_b_processed_at, last_tier_b_commit_sha FROM ${SchemaTables.PROJECT_FILES} WHERE ${SchemaColumns.FILE_PATH} = ? LIMIT 1`,
      )
      .get(filePath) as
      | {
          last_tier_b_processed_at: string | null;
          last_tier_b_commit_sha: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      lastProcessedAt: row.last_tier_b_processed_at,
      lastProcessedCommitSha: row.last_tier_b_commit_sha,
    };
  }

  /**
   * Workspace-wide Tier B coverage — one cheap aggregate query, no row materialization. `SUM`
   * returns `NULL` (not `0`) over an empty table, so `processed` falls back to `0`.
   */
  getTierBCoverage(): { totalFiles: number; processedFiles: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN last_tier_b_processed_at IS NOT NULL THEN 1 ELSE 0 END) as processed FROM ${SchemaTables.PROJECT_FILES}`,
      )
      .get() as { total: number; processed: number | null };
    return { totalFiles: row.total, processedFiles: row.processed ?? 0 };
  }
}

function parsePersistedSourceFile(
  filePath: string,
  json: string | null,
): PersistedCallResolutionSourceFile | undefined {
  if (!json) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }

  return isPersistedSourceFile(value, filePath) ? value : undefined;
}

function isPersistedSourceFile(
  value: unknown,
  filePath: string,
): value is PersistedCallResolutionSourceFile {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CALL_RESOLUTION_SOURCE_INDEX_SCHEMA_VERSION
  )
    return false;
  const sourceFile = value.sourceFile;
  return (
    isRecord(sourceFile) &&
    hasSourceFileIdentity(sourceFile, filePath) &&
    hasSourceFileFacts(sourceFile) &&
    hasFunctionNodeReferences(value.functionNodeReferences) &&
    hasResolverLocalSymbols(value.resolverLocalSymbols)
  );
}

function hasFunctionNodeReferences(
  value: unknown,
): value is readonly CallResolutionFunctionNodeReference[] {
  return Array.isArray(value) && value.every(isFunctionNodeReference);
}

function hasResolverLocalSymbols(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((symbol) => typeof symbol === "string")
  );
}

function isFunctionNodeReference(
  value: unknown,
): value is CallResolutionFunctionNodeReference {
  if (!isRecord(value)) return false;
  return (
    hasFunctionNodeIdentity(value) &&
    hasFunctionNodeLocation(value) &&
    hasFunctionNodeTargets(value)
  );
}

function hasFunctionNodeIdentity(value: Record<string, unknown>): boolean {
  return (
    typeof value.nodeKey === "string" &&
    typeof value.name === "string" &&
    (value.containerName === undefined ||
      typeof value.containerName === "string")
  );
}

function hasFunctionNodeLocation(value: Record<string, unknown>): boolean {
  return (
    Number.isSafeInteger(value.startLine) &&
    Number.isSafeInteger(value.endLine) &&
    (value.declarationSpan === undefined ||
      isValidDeclarationSpan(value.declarationSpan))
  );
}

function hasFunctionNodeTargets(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.declarationTargetKeys) &&
    value.declarationTargetKeys.every((key: unknown) => typeof key === "string")
  );
}

function isValidDeclarationSpan(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.start) &&
    Number.isSafeInteger(value.end) &&
    Number(value.start) <= Number(value.end)
  );
}

function hasSourceFileIdentity(
  sourceFile: Record<string, unknown>,
  filePath: string,
): boolean {
  return (
    sourceFile.filePath === filePath &&
    typeof sourceFile.sourceContentHash === "string" &&
    /^[a-f0-9]{64}$/u.test(sourceFile.sourceContentHash)
  );
}

function hasSourceFileFacts(sourceFile: Record<string, unknown>): boolean {
  return (
    Array.isArray(sourceFile.imports) &&
    Array.isArray(sourceFile.exports) &&
    (sourceFile.reexports === undefined ||
      Array.isArray(sourceFile.reexports)) &&
    "declaredTypeFacts" in sourceFile &&
    (sourceFile.declaredTypeFacts === null ||
      isRecord(sourceFile.declaredTypeFacts)) &&
    "callSiteShapeFacts" in sourceFile &&
    (sourceFile.callSiteShapeFacts === null ||
      isRecord(sourceFile.callSiteShapeFacts))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
