import type Database from "better-sqlite3";
import {
  CallSiteResolutionClasses,
  CallSiteResolutionDependencyKinds,
  CallSiteResolutionObservationSources,
  CallSiteRuleQuarantineReasons,
  CallSiteVerificationStatuses,
  CALL_SITE_VERIFICATION_POLICY_VERSION,
  DocuviaError,
  ErrorCodes,
  LinkTypes,
} from "@workspace/contracts";
import type {
  CallSiteResolutionCandidate,
  CallSiteResolutionClass,
  CallSiteResolutionDependency,
  CallSiteResolutionInvalidationResult,
  CallSiteResolutionObservation,
  CallSiteResolutionObservationInput,
  CallSiteResolutionRecord,
  SnapshotCallResolutionRow,
  CallSiteResolutionProjectionCallerInput,
  CallSiteLspResolutionResult,
  CallSiteRuleQuarantine,
  CallSiteRuleQuarantineClearAudit,
  CallSiteRuleQuarantineClearRequest,
  CallSiteRuleQuarantineClearResult,
  CallSiteVerificationApplyResult,
  CallSiteResolutionObservationSource,
  CallSiteVerificationStatus,
  ICallSiteResolutionsRepo,
} from "@workspace/contracts";
import { SchemaColumns, SchemaTables } from "../constants.js";

const CALL_SITE_RESOLUTIONS_ERRORS = {
  READ_FILE_FAILED: (projectId: number, filePath: string) =>
    `Failed to read call-site resolutions for ${filePath} in project ${projectId}`,
  REPLACE_FILE_FAILED: (projectId: number, filePath: string) =>
    `Failed to replace call-site resolutions for ${filePath} in project ${projectId}`,
  DELETE_FILE_FAILED: (projectId: number, filePath: string) =>
    `Failed to delete current call-site resolutions for ${filePath} in project ${projectId}`,
  APPEND_OBSERVATION_FAILED: (projectId: number, callSiteKey: string) =>
    `Failed to append call-site observation ${callSiteKey} in project ${projectId}`,
  READ_OBSERVATIONS_FAILED: (projectId: number, filePath: string) =>
    `Failed to read call-site observations for ${filePath} in project ${projectId}`,
  INVALIDATE_DEPENDENCIES_FAILED: (projectId: number) =>
    `Failed to invalidate call-site resolutions for changed dependencies in project ${projectId}`,
  INVALIDATE_ALL_FAILED: (projectId: number) =>
    `Failed to invalidate all call-site resolutions in project ${projectId}`,
  APPLY_TIER_B_RESULTS_FAILED: (projectId: number) =>
    `Failed to apply Tier B verification results for project ${projectId}`,
  READ_RULE_QUARANTINES_FAILED: (projectId: number) =>
    `Failed to read call-site rule quarantines for project ${projectId}`,
  READ_RULE_QUARANTINE_AUDITS_FAILED: (projectId: number) =>
    `Failed to read call-site rule quarantine clear audits for project ${projectId}`,
  CLEAR_RULE_QUARANTINE_FAILED: (projectId: number, ruleSignature: string) =>
    `Failed to clear call-site rule quarantine ${ruleSignature} in project ${projectId}`,
  READ_PROJECT_FAILED: (projectId: number) =>
    `Failed to read portable call-site resolutions for project ${projectId}`,
  REPLACE_PROJECT_FAILED: (projectId: number) =>
    `Failed to replace portable call-site resolutions for project ${projectId}`,
} as const;

const QUARANTINE_CLEAR_AUDIT_COLUMNS = `id, rule_signature,
  quarantine_policy_version, quarantine_reason, quarantine_call_site_key,
  quarantine_source_content_hash, expected_target_node_key,
  observed_target_node_key, quarantine_created_at, cleared_at, clear_method,
  evidence_sha256, operator, reason, previous_rule_configuration_sha256,
  new_rule_configuration_sha256`;

interface ResolutionDbRow {
  call_site_key: string;
  identity_version: 1;
  file_path: string;
  source_content_hash: string;
  start_line: number;
  start_column: number;
  callee_kind: string;
  callee_name: string;
  caller_node_key: string;
  resolution_class: CallSiteResolutionClass;
  selected_target_node_key: string | null;
  confidence: number | null;
  resolver: string;
  rule_signature: string;
  dependency_fingerprint: string;
  verification_status: CallSiteVerificationStatus;
  verified_target_node_key: string | null;
  is_stale: 0 | 1;
  ordinal: number | null;
  candidate_target_node_key: string | null;
  evidence_json: string | null;
}

interface ObservationDbRow {
  id: number;
  call_site_key: string;
  file_path: string;
  source_content_hash: string;
  source: CallSiteResolutionObservationSource;
  resolution_class: CallSiteResolutionClass | null;
  target_node_key: string | null;
  resolver: string | null;
  rule_signature: string | null;
  evidence_json: string;
  created_at: string;
}

interface QuarantineDbRow {
  project_id: number;
  rule_signature: string;
  policy_version: string;
  reason: CallSiteRuleQuarantine["reason"];
  call_site_key: string;
  source_content_hash: string;
  expected_target_node_key: string;
  observed_target_node_key: string;
  rule_configuration_sha256: string | null;
  created_at: string;
}

interface QuarantineClearAuditDbRow {
  id: number;
  rule_signature: string;
  quarantine_policy_version: string;
  quarantine_reason: CallSiteRuleQuarantine["reason"];
  quarantine_call_site_key: string;
  quarantine_source_content_hash: string;
  expected_target_node_key: string;
  observed_target_node_key: string;
  quarantine_created_at: string;
  cleared_at: string;
  clear_method: CallSiteRuleQuarantineClearAudit["method"];
  evidence_sha256: string | null;
  operator: string | null;
  reason: string | null;
  previous_rule_configuration_sha256: string;
  new_rule_configuration_sha256: string;
}

interface DependencyDbRow {
  call_site_key: string;
  dependency_kind: "file" | "candidate-member";
  dependency_path: string;
  content_hash: string | null;
}

interface VerificationDbRow {
  call_site_key: string;
  file_path: string;
  source_content_hash: string;
  resolution_class: CallSiteResolutionClass;
  selected_target_node_key: string | null;
  rule_signature: string;
  is_stale: 0 | 1;
}

/** Current per-site resolution, normalized alternatives, and append-only evidence history. */
export class CallSiteResolutionsRepo implements ICallSiteResolutionsRepo {
  constructor(private readonly db: Database.Database) {}

  replaceForFile(
    projectId: number,
    filePath: string,
    resolutions: CallSiteResolutionRecord[],
    projectionCallers: CallSiteResolutionProjectionCallerInput[] = [],
  ): void {
    assertProjectId(projectId);
    assertWorkspacePath(filePath);
    if (!Array.isArray(resolutions)) {
      throw invalidInput("Call-site resolutions must be an array");
    }
    for (const resolution of resolutions) {
      validateResolution(filePath, resolution);
    }
    if (!Array.isArray(projectionCallers)) {
      throw invalidInput("Call-site projection callers must be an array");
    }
    const resolutionKeys = new Set(
      resolutions.map(({ callSiteKey }) => callSiteKey),
    );
    const projectionCallerKeys = new Set<string>();
    for (const projectionCaller of projectionCallers) {
      assertNonEmpty(projectionCaller.callSiteKey, "projection call-site key");
      assertNonEmpty(
        projectionCaller.callerNodeKey,
        "projection caller node key",
      );
      if (!resolutionKeys.has(projectionCaller.callSiteKey)) {
        throw invalidInput(
          "Call-site projection caller must match a replacement resolution",
        );
      }
      if (projectionCallerKeys.has(projectionCaller.callSiteKey)) {
        throw invalidInput("Call-site projection caller keys must be unique");
      }
      projectionCallerKeys.add(projectionCaller.callSiteKey);
    }
    const projectionCallerByCallSite = new Map(
      projectionCallers.map((caller) => [caller.callSiteKey, caller] as const),
    );

    try {
      this.db
        .transaction(() => {
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTION_CANDIDATES}
               WHERE project_id = ? AND call_site_key IN (
                 SELECT call_site_key FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
                 WHERE project_id = ? AND file_path = ?
               )`,
            )
            .run(projectId, projectId, filePath);
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES}
               WHERE project_id = ? AND call_site_key IN (
                 SELECT call_site_key FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
                 WHERE project_id = ? AND file_path = ?
               )`,
            )
            .run(projectId, projectId, filePath);
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
               WHERE project_id = ? AND file_path = ?`,
            )
            .run(projectId, filePath);

          const insertResolution = this.db.prepare(
            `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTIONS} (
              project_id, call_site_key, identity_version, file_path, source_content_hash,
              start_line, start_column, callee_kind, callee_name, caller_node_key,
              resolution_class, selected_target_node_key, confidence, resolver, rule_signature,
              dependency_fingerprint, verification_status, verified_target_node_key, is_stale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          const insertCandidate = this.db.prepare(
            `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTION_CANDIDATES} (
              project_id, call_site_key, ordinal, target_node_key, evidence_json
            ) VALUES (?, ?, ?, ?, ?)`,
          );
          const insertProjectionCaller = this.db.prepare(
            `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTION_PROJECTION_CALLERS} (
              project_id, call_site_key, caller_node_key
            ) VALUES (?, ?, ?)`,
          );
          const insertDependency = this.db.prepare(
            `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} (
              project_id, call_site_key, dependency_kind, dependency_path, content_hash
            ) VALUES (?, ?, ?, ?, ?)`,
          );

          for (const resolution of resolutions) {
            const currentResolution = resolution;
            insertResolution.run(
              projectId,
              currentResolution.callSiteKey,
              currentResolution.identityVersion,
              currentResolution.filePath,
              currentResolution.sourceContentHash,
              currentResolution.startLine,
              currentResolution.startColumn,
              currentResolution.calleeKind,
              currentResolution.calleeName,
              currentResolution.callerNodeKey,
              currentResolution.resolutionClass,
              currentResolution.selectedTargetNodeKey,
              currentResolution.confidence,
              currentResolution.resolver,
              currentResolution.ruleSignature,
              currentResolution.dependencyFingerprint,
              currentResolution.verificationStatus,
              currentResolution.verifiedTargetNodeKey,
              currentResolution.isStale ? 1 : 0,
            );
            for (const candidate of currentResolution.candidates) {
              insertCandidate.run(
                projectId,
                currentResolution.callSiteKey,
                candidate.ordinal,
                candidate.targetNodeKey,
                candidate.evidenceJson,
              );
            }
            const projectionCaller = projectionCallerByCallSite.get(
              currentResolution.callSiteKey,
            );
            if (projectionCaller) {
              insertProjectionCaller.run(
                projectId,
                projectionCaller.callSiteKey,
                projectionCaller.callerNodeKey,
              );
            }
            for (const dependency of normalizeResolutionDependencies(
              currentResolution,
            )) {
              insertDependency.run(
                projectId,
                currentResolution.callSiteKey,
                dependency.kind ?? CallSiteResolutionDependencyKinds.FILE,
                dependency.filePath,
                dependency.contentHash,
              );
            }
          }

          rebuildCallsProjection(this.db, projectId, filePath);
        })
        .immediate();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.REPLACE_FILE_FAILED(projectId, filePath),
        err,
      );
    }
  }

  deleteForFile(projectId: number, filePath: string): void {
    assertProjectId(projectId);
    assertWorkspacePath(filePath);
    try {
      this.db
        .transaction(() => {
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTION_CANDIDATES}
               WHERE project_id = ? AND call_site_key IN (
                 SELECT call_site_key FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
                 WHERE project_id = ? AND file_path = ?
               )`,
            )
            .run(projectId, projectId, filePath);
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES}
               WHERE project_id = ? AND call_site_key IN (
                 SELECT call_site_key FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
                 WHERE project_id = ? AND file_path = ?
               )`,
            )
            .run(projectId, projectId, filePath);
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
               WHERE project_id = ? AND file_path = ?`,
            )
            .run(projectId, filePath);

          rebuildCallsProjection(this.db, projectId, filePath);
        })
        .immediate();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.DELETE_FILE_FAILED(projectId, filePath),
        err,
      );
    }
  }

  getForFile(projectId: number, filePath: string): CallSiteResolutionRecord[] {
    assertProjectId(projectId);
    assertWorkspacePath(filePath);
    try {
      const rows = this.db
        .prepare(
          `SELECT r.call_site_key, r.identity_version, r.file_path, r.source_content_hash,
                  r.start_line, r.start_column, r.callee_kind, r.callee_name,
                  r.caller_node_key, r.resolution_class, r.selected_target_node_key,
                  r.confidence, r.resolver, r.rule_signature, r.dependency_fingerprint,
                  r.verification_status, r.verified_target_node_key, r.is_stale,
                  c.ordinal, c.target_node_key AS candidate_target_node_key, c.evidence_json
           FROM ${SchemaTables.CALL_SITE_RESOLUTIONS} r
           LEFT JOIN ${SchemaTables.CALL_SITE_RESOLUTION_CANDIDATES} c
             ON c.project_id = r.project_id AND c.call_site_key = r.call_site_key
           WHERE r.project_id = ? AND r.file_path = ?
           ORDER BY r.call_site_key COLLATE BINARY, c.ordinal`,
        )
        .all(projectId, filePath) as ResolutionDbRow[];

      const result = buildResolutionRecords(rows);
      const dependencyRows = this.db
        .prepare(
          `SELECT d.call_site_key, d.dependency_kind, d.dependency_path, d.content_hash
           FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} d
           JOIN ${SchemaTables.CALL_SITE_RESOLUTIONS} r
             ON r.project_id = d.project_id AND r.call_site_key = d.call_site_key
           WHERE r.project_id = ? AND r.file_path = ?
           ORDER BY d.call_site_key COLLATE BINARY, d.dependency_kind COLLATE BINARY,
                    d.dependency_path COLLATE BINARY`,
        )
        .all(projectId, filePath) as DependencyDbRow[];
      appendResolutionDependencies(result, dependencyRows);
      return result;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.READ_FILE_FAILED(projectId, filePath),
        err,
      );
    }
  }

  getForProjectionEdge(
    projectId: number,
    callerNodeKey: string,
    targetNodeKey: string,
  ): SnapshotCallResolutionRow[] {
    assertProjectId(projectId);
    try {
      const rows = this.db
        .prepare(
          `SELECT r.call_site_key, r.identity_version, r.file_path, r.source_content_hash,
                  r.start_line, r.start_column, r.callee_kind, r.callee_name,
                  r.caller_node_key, r.resolution_class, r.selected_target_node_key,
                  r.confidence, r.resolver, r.rule_signature, r.dependency_fingerprint,
                  r.verification_status, r.verified_target_node_key, r.is_stale,
                  c.ordinal, c.target_node_key AS candidate_target_node_key, c.evidence_json
           FROM ${SchemaTables.CALL_SITE_RESOLUTIONS} r
           JOIN ${SchemaTables.CALL_SITE_RESOLUTION_PROJECTION_CALLERS} p
             ON p.project_id = r.project_id AND p.call_site_key = r.call_site_key
           LEFT JOIN ${SchemaTables.CALL_SITE_RESOLUTION_CANDIDATES} c
             ON c.project_id = r.project_id AND c.call_site_key = r.call_site_key
           WHERE r.project_id = ? AND p.caller_node_key = ?
             AND r.selected_target_node_key = ?
           ORDER BY r.call_site_key COLLATE BINARY, c.ordinal`,
        )
        .all(projectId, callerNodeKey, targetNodeKey) as ResolutionDbRow[];
      const records = buildResolutionRecords(rows);
      if (records.length === 0) return [];

      const dependencyRows = this.db
        .prepare(
          `SELECT d.call_site_key, d.dependency_kind, d.dependency_path, d.content_hash
           FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} d
           JOIN ${SchemaTables.CALL_SITE_RESOLUTION_PROJECTION_CALLERS} p
             ON p.project_id = d.project_id AND p.call_site_key = d.call_site_key
           JOIN ${SchemaTables.CALL_SITE_RESOLUTIONS} r
             ON r.project_id = d.project_id AND r.call_site_key = d.call_site_key
           WHERE d.project_id = ? AND p.caller_node_key = ?
             AND r.selected_target_node_key = ?
           ORDER BY d.call_site_key COLLATE BINARY, d.dependency_kind COLLATE BINARY,
                    d.dependency_path COLLATE BINARY`,
        )
        .all(projectId, callerNodeKey, targetNodeKey) as DependencyDbRow[];
      appendResolutionDependencies(records, dependencyRows);
      return records.map((record) => ({
        ...record,
        projectionCallerNodeKey: callerNodeKey,
      }));
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.READ_PROJECT_FAILED(projectId),
        err,
      );
    }
  }

  getAllForProject(projectId: number): SnapshotCallResolutionRow[] {
    assertProjectId(projectId);
    try {
      const filePaths = this.db
        .prepare(
          `SELECT DISTINCT file_path FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
           WHERE project_id = ? ORDER BY file_path COLLATE BINARY`,
        )
        .all(projectId) as Array<{ file_path: string }>;
      const projectionRows = this.db
        .prepare(
          `SELECT call_site_key, caller_node_key
           FROM ${SchemaTables.CALL_SITE_RESOLUTION_PROJECTION_CALLERS}
           WHERE project_id = ? ORDER BY call_site_key COLLATE BINARY`,
        )
        .all(projectId) as Array<{
        call_site_key: string;
        caller_node_key: string;
      }>;
      const projectionCallerByKey = new Map(
        projectionRows.map((row) => [row.call_site_key, row.caller_node_key]),
      );
      return filePaths
        .flatMap(({ file_path: filePath }) =>
          this.getForFile(projectId, filePath).map((resolution) => ({
            ...resolution,
            projectionCallerNodeKey:
              projectionCallerByKey.get(resolution.callSiteKey) ?? null,
          })),
        )
        .sort((left, right) =>
          left.callSiteKey < right.callSiteKey
            ? -1
            : left.callSiteKey > right.callSiteKey
              ? 1
              : 0,
        );
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.READ_PROJECT_FAILED(projectId),
        err,
      );
    }
  }

  replaceForProject(
    projectId: number,
    resolutions: SnapshotCallResolutionRow[],
  ): void {
    assertProjectId(projectId);
    if (!Array.isArray(resolutions)) {
      throw invalidInput("Call-site resolutions must be an array");
    }
    const callSiteKeys = new Set<string>();
    for (const resolution of resolutions) {
      validateResolution(resolution.filePath, resolution);
      if (callSiteKeys.has(resolution.callSiteKey)) {
        throw invalidInput("Call-site resolution keys must be unique");
      }
      callSiteKeys.add(resolution.callSiteKey);
      if (
        resolution.projectionCallerNodeKey !== null &&
        (typeof resolution.projectionCallerNodeKey !== "string" ||
          resolution.projectionCallerNodeKey.length === 0)
      ) {
        throw invalidInput(
          "Projection caller node key must be non-empty or null",
        );
      }
    }
    try {
      this.db
        .transaction(() => {
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTION_CANDIDATES} WHERE project_id = ?`,
            )
            .run(projectId);
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} WHERE project_id = ?`,
            )
            .run(projectId);
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTION_PROJECTION_CALLERS} WHERE project_id = ?`,
            )
            .run(projectId);
          this.db
            .prepare(
              `DELETE FROM ${SchemaTables.CALL_SITE_RESOLUTIONS} WHERE project_id = ?`,
            )
            .run(projectId);

          const insertResolution = this.db.prepare(
            `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTIONS} (
              project_id, call_site_key, identity_version, file_path, source_content_hash,
              start_line, start_column, callee_kind, callee_name, caller_node_key,
              resolution_class, selected_target_node_key, confidence, resolver, rule_signature,
              dependency_fingerprint, verification_status, verified_target_node_key, is_stale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          const insertCandidate = this.db.prepare(
            `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTION_CANDIDATES} (
              project_id, call_site_key, ordinal, target_node_key, evidence_json
            ) VALUES (?, ?, ?, ?, ?)`,
          );
          const insertProjectionCaller = this.db.prepare(
            `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTION_PROJECTION_CALLERS} (
              project_id, call_site_key, caller_node_key
            ) VALUES (?, ?, ?)`,
          );
          const insertDependency = this.db.prepare(
            `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} (
              project_id, call_site_key, dependency_kind, dependency_path, content_hash
            ) VALUES (?, ?, ?, ?, ?)`,
          );
          for (const resolution of resolutions) {
            insertResolution.run(
              projectId,
              resolution.callSiteKey,
              resolution.identityVersion,
              resolution.filePath,
              resolution.sourceContentHash,
              resolution.startLine,
              resolution.startColumn,
              resolution.calleeKind,
              resolution.calleeName,
              resolution.callerNodeKey,
              resolution.resolutionClass,
              resolution.selectedTargetNodeKey,
              resolution.confidence,
              resolution.resolver,
              resolution.ruleSignature,
              resolution.dependencyFingerprint,
              resolution.verificationStatus,
              resolution.verifiedTargetNodeKey,
              resolution.isStale ? 1 : 0,
            );
            for (const candidate of resolution.candidates) {
              insertCandidate.run(
                projectId,
                resolution.callSiteKey,
                candidate.ordinal,
                candidate.targetNodeKey,
                candidate.evidenceJson,
              );
            }
            if (resolution.projectionCallerNodeKey !== null) {
              insertProjectionCaller.run(
                projectId,
                resolution.callSiteKey,
                resolution.projectionCallerNodeKey,
              );
            }
            for (const dependency of normalizeResolutionDependencies(
              resolution,
            )) {
              insertDependency.run(
                projectId,
                resolution.callSiteKey,
                dependency.kind ?? CallSiteResolutionDependencyKinds.FILE,
                dependency.filePath,
                dependency.contentHash,
              );
            }
          }
        })
        .immediate();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.REPLACE_PROJECT_FAILED(projectId),
        err,
      );
    }
  }

  applyTierBVerificationResults(
    projectId: number,
    results: CallSiteLspResolutionResult[],
    ruleConfigurationSha256?: string,
  ): CallSiteVerificationApplyResult {
    assertProjectId(projectId);
    validateTierBResults(results);
    if (ruleConfigurationSha256 !== undefined)
      assertHash(ruleConfigurationSha256, "rule configuration hash");
    try {
      return applyTierBVerificationResultsTransaction(
        this.db,
        this,
        projectId,
        results,
        ruleConfigurationSha256 ?? null,
      );
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.APPLY_TIER_B_RESULTS_FAILED(projectId),
        err,
      );
    }
  }

  getQuarantinedRuleSignatures(projectId: number): string[] {
    assertProjectId(projectId);
    return this.getRuleQuarantines(projectId).map(
      ({ ruleSignature }) => ruleSignature,
    );
  }

  getRuleQuarantines(projectId: number): CallSiteRuleQuarantine[] {
    assertProjectId(projectId);
    try {
      const rows = this.db
        .prepare(
          `SELECT rule_signature, policy_version, reason, call_site_key,
                  source_content_hash, expected_target_node_key,
                  observed_target_node_key, rule_configuration_sha256, created_at
           FROM ${SchemaTables.CALL_SITE_RULE_QUARANTINES}
           WHERE project_id = ? ORDER BY rule_signature COLLATE BINARY`,
        )
        .all(projectId) as Array<{
        rule_signature: string;
        policy_version: string;
        reason: CallSiteRuleQuarantine["reason"];
        call_site_key: string;
        source_content_hash: string;
        expected_target_node_key: string;
        observed_target_node_key: string;
        rule_configuration_sha256: string | null;
        created_at: string;
      }>;
      return rows.map((row) => ({
        ruleSignature: row.rule_signature,
        policyVersion: row.policy_version,
        reason: row.reason,
        callSiteKey: row.call_site_key,
        sourceContentHash: row.source_content_hash,
        expectedTargetNodeKey: row.expected_target_node_key,
        observedTargetNodeKey: row.observed_target_node_key,
        ruleConfigurationSha256: row.rule_configuration_sha256,
        createdAt: row.created_at,
      }));
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.READ_RULE_QUARANTINES_FAILED(projectId),
        err,
      );
    }
  }

  getRuleQuarantineClearAudits(
    projectId: number,
  ): CallSiteRuleQuarantineClearAudit[] {
    assertProjectId(projectId);
    try {
      const rows = this.db
        .prepare(
          `SELECT id, rule_signature, quarantine_policy_version,
                  quarantine_reason, quarantine_call_site_key,
                  quarantine_source_content_hash, expected_target_node_key,
                  observed_target_node_key, quarantine_created_at, cleared_at,
                  clear_method, evidence_sha256, operator, reason,
                  previous_rule_configuration_sha256,
                  new_rule_configuration_sha256
           FROM ${SchemaTables.CALL_SITE_RULE_QUARANTINE_CLEAR_AUDITS}
           WHERE project_id = ?
           ORDER BY id DESC`,
        )
        .all(projectId) as QuarantineClearAuditDbRow[];
      return rows.map(mapQuarantineClearAudit);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.READ_RULE_QUARANTINE_AUDITS_FAILED(
          projectId,
        ),
        err,
      );
    }
  }

  clearRuleQuarantine(
    projectId: number,
    ruleSignature: string,
    request: CallSiteRuleQuarantineClearRequest,
  ): CallSiteRuleQuarantineClearResult {
    assertProjectId(projectId);
    validateQuarantineClearRequest(ruleSignature, request);
    try {
      return this.db
        .transaction(() =>
          clearRuleQuarantineInTransaction(
            this.db,
            projectId,
            ruleSignature,
            request,
          ),
        )
        .immediate();
    } catch (err) {
      if (err instanceof DocuviaError) throw err;
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.CLEAR_RULE_QUARANTINE_FAILED(
          projectId,
          ruleSignature,
        ),
        err,
      );
    }
  }

  invalidateChangedDependencies(
    projectId: number,
    changedDependencies: CallSiteResolutionDependency[],
  ): CallSiteResolutionInvalidationResult {
    assertProjectId(projectId);
    const dependencies = normalizeChangedDependencies(changedDependencies);
    if (dependencies.length === 0) {
      return { invalidatedCount: 0, affectedFilePaths: [] };
    }

    try {
      return this.db
        .transaction(() => {
          const markStale = this.db.prepare(
            `UPDATE ${SchemaTables.CALL_SITE_RESOLUTIONS}
             SET is_stale = 1
             WHERE project_id = ? AND is_stale = 0
               AND EXISTS (
                 SELECT 1
                 FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} d
                 WHERE d.project_id = ${SchemaTables.CALL_SITE_RESOLUTIONS}.project_id
                   AND d.call_site_key = ${SchemaTables.CALL_SITE_RESOLUTIONS}.call_site_key
                   AND d.dependency_kind = ?
                   AND d.dependency_path = ?
                   AND (d.dependency_kind = 'candidate-member' OR d.content_hash IS NOT ?)
               )`,
          );
          const findAffectedFiles = this.db.prepare(
            `SELECT DISTINCT r.file_path
             FROM ${SchemaTables.CALL_SITE_RESOLUTIONS} r
             WHERE r.project_id = ? AND r.is_stale = 0
               AND EXISTS (
                 SELECT 1
                 FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} d
                 WHERE d.project_id = r.project_id
                   AND d.call_site_key = r.call_site_key
                   AND d.dependency_kind = ?
                   AND d.dependency_path = ?
                   AND (d.dependency_kind = 'candidate-member' OR d.content_hash IS NOT ?)
               )`,
          );
          let newlyStale = 0;
          const affectedFiles = new Set<string>();
          for (const dependency of dependencies) {
            for (const { file_path: filePath } of findAffectedFiles.all(
              projectId,
              dependency.kind ?? CallSiteResolutionDependencyKinds.FILE,
              dependency.filePath,
              dependency.contentHash,
            ) as Array<{ file_path: string }>) {
              affectedFiles.add(filePath);
            }
            newlyStale += markStale.run(
              projectId,
              dependency.kind ?? CallSiteResolutionDependencyKinds.FILE,
              dependency.filePath,
              dependency.contentHash,
            ).changes;
          }
          for (const filePath of affectedFiles) {
            rebuildCallsProjection(this.db, projectId, filePath);
          }
          return {
            invalidatedCount: newlyStale,
            affectedFilePaths: [...affectedFiles].sort(comparePaths),
          };
        })
        .immediate();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.INVALIDATE_DEPENDENCIES_FAILED(projectId),
        err,
      );
    }
  }

  invalidateCandidateDomainProofs(
    projectId: number,
  ): CallSiteResolutionInvalidationResult {
    assertProjectId(projectId);
    try {
      return this.db
        .transaction(() => {
          const affectedFilePaths = (
            this.db
              .prepare(
                `SELECT DISTINCT r.file_path
                 FROM ${SchemaTables.CALL_SITE_RESOLUTIONS} r
                 WHERE r.project_id = ? AND r.is_stale = 0
                   AND r.resolver = 'strict-proof'
                   AND (
                     r.resolution_class = ? OR EXISTS (
                       SELECT 1
                       FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} d
                       WHERE d.project_id = r.project_id
                         AND d.call_site_key = r.call_site_key
                         AND d.dependency_kind = 'candidate-member'
                     )
                   )
                 ORDER BY r.file_path COLLATE BINARY`,
              )
              .all(projectId, CallSiteResolutionClasses.PROVEN) as Array<{
              file_path: string;
            }>
          ).map(({ file_path: filePath }) => filePath);
          const result = this.db
            .prepare(
              `UPDATE ${SchemaTables.CALL_SITE_RESOLUTIONS} AS r
               SET is_stale = 1
               WHERE r.project_id = ? AND r.is_stale = 0
                 AND r.resolver = 'strict-proof'
                 AND (
                   r.resolution_class = ? OR EXISTS (
                     SELECT 1
                     FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} d
                     WHERE d.project_id = r.project_id
                       AND d.call_site_key = r.call_site_key
                       AND d.dependency_kind = 'candidate-member'
                   )
                 )`,
            )
            .run(projectId, CallSiteResolutionClasses.PROVEN);
          for (const filePath of affectedFilePaths) {
            rebuildCallsProjection(this.db, projectId, filePath);
          }
          return {
            invalidatedCount: result.changes,
            affectedFilePaths,
          };
        })
        .immediate();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.INVALIDATE_DEPENDENCIES_FAILED(projectId),
        err,
      );
    }
  }

  hasMissingCandidateMemberDependencies(projectId: number): boolean {
    assertProjectId(projectId);
    try {
      const row = this.db
        .prepare(
          `SELECT 1 AS missing
           FROM ${SchemaTables.CALL_SITE_RESOLUTIONS} r
           WHERE r.project_id = ? AND r.resolver = 'strict-proof'
             AND NOT EXISTS (
               SELECT 1
               FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} d
               WHERE d.project_id = r.project_id
                 AND d.call_site_key = r.call_site_key
                 AND d.dependency_kind = 'candidate-member'
             )
           LIMIT 1`,
        )
        .get(projectId) as { missing: 1 } | undefined;
      return row !== undefined;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.INVALIDATE_DEPENDENCIES_FAILED(projectId),
        err,
      );
    }
  }

  invalidateAll(projectId: number): CallSiteResolutionInvalidationResult {
    assertProjectId(projectId);
    try {
      return this.db
        .transaction(() => {
          const affectedFilePaths = (
            this.db
              .prepare(
                `SELECT DISTINCT file_path
                 FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
                 WHERE project_id = ? AND is_stale = 0`,
              )
              .all(projectId) as Array<{ file_path: string }>
          )
            .map(({ file_path: filePath }) => filePath)
            .sort(comparePaths);
          const invalidatedCount = this.db
            .prepare(
              `UPDATE ${SchemaTables.CALL_SITE_RESOLUTIONS}
               SET is_stale = 1
               WHERE project_id = ? AND is_stale = 0`,
            )
            .run(projectId).changes;
          for (const filePath of affectedFilePaths) {
            rebuildCallsProjection(this.db, projectId, filePath);
          }
          return { invalidatedCount, affectedFilePaths };
        })
        .immediate();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.INVALIDATE_ALL_FAILED(projectId),
        err,
      );
    }
  }

  appendObservation(
    projectId: number,
    observation: CallSiteResolutionObservationInput,
  ): void {
    assertProjectId(projectId);
    validateObservation(observation);
    try {
      this.db
        .prepare(
          `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTION_OBSERVATIONS} (
            project_id, call_site_key, file_path, source_content_hash, source,
            resolution_class, target_node_key, resolver, rule_signature, evidence_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          projectId,
          observation.callSiteKey,
          observation.filePath,
          observation.sourceContentHash,
          observation.source,
          observation.resolutionClass ?? null,
          observation.targetNodeKey,
          observation.resolver ?? null,
          observation.ruleSignature ?? null,
          observation.evidenceJson,
        );
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.APPEND_OBSERVATION_FAILED(
          projectId,
          observation.callSiteKey,
        ),
        err,
      );
    }
  }

  getObservations(
    projectId: number,
    filePath: string,
  ): CallSiteResolutionObservation[] {
    assertProjectId(projectId);
    assertWorkspacePath(filePath);
    try {
      const rows = this.db
        .prepare(
          `SELECT id, call_site_key, file_path, source_content_hash, source,
                  resolution_class, target_node_key, resolver, rule_signature,
                  evidence_json, created_at
           FROM ${SchemaTables.CALL_SITE_RESOLUTION_OBSERVATIONS}
           WHERE project_id = ? AND file_path = ? ORDER BY id`,
        )
        .all(projectId, filePath) as ObservationDbRow[];
      return rows.map((row) => ({
        id: row.id,
        callSiteKey: row.call_site_key,
        filePath: row.file_path,
        sourceContentHash: row.source_content_hash,
        source: row.source,
        resolutionClass: row.resolution_class,
        targetNodeKey: row.target_node_key,
        resolver: row.resolver,
        ruleSignature: row.rule_signature,
        evidenceJson: row.evidence_json,
        createdAt: row.created_at,
      }));
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.READ_OBSERVATIONS_FAILED(
          projectId,
          filePath,
        ),
        err,
      );
    }
  }
}

function validateResolution(
  requestedFilePath: string,
  resolution: CallSiteResolutionRecord,
): void {
  assertPortableKey(resolution?.callSiteKey);
  validateResolutionIdentity(requestedFilePath, resolution);
  validateResolutionEvidence(resolution);
  validateSelectionAndConfidence(resolution);
  validateVerification(resolution);
  validateCandidates(resolution.candidates);
  normalizeResolutionDependencies(resolution);
}

interface TierBApplyState {
  updatedCallSiteKeys: Set<string>;
  affectedFilePaths: Set<string>;
  quarantinedRuleSignatures: Set<string>;
}

function applyTierBVerificationResultsTransaction(
  db: Database.Database,
  repo: CallSiteResolutionsRepo,
  projectId: number,
  results: CallSiteLspResolutionResult[],
  ruleConfigurationSha256: string | null,
): CallSiteVerificationApplyResult {
  const findResolution = db.prepare<[number, string], VerificationDbRow>(
    `SELECT call_site_key, file_path, source_content_hash, resolution_class,
            selected_target_node_key, rule_signature, is_stale
     FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
     WHERE project_id = ? AND call_site_key = ?`,
  );
  return db
    .transaction(() => {
      const state: TierBApplyState = {
        updatedCallSiteKeys: new Set(),
        affectedFilePaths: new Set(),
        quarantinedRuleSignatures: new Set(),
      };
      for (const result of results) {
        applyOneTierBVerificationResult(
          db,
          repo,
          findResolution,
          projectId,
          result,
          state,
          ruleConfigurationSha256,
        );
      }
      for (const filePath of state.affectedFilePaths) {
        rebuildCallsProjection(db, projectId, filePath);
      }
      return {
        updatedCallSiteKeys: [...state.updatedCallSiteKeys].sort(),
        affectedFilePaths: [...state.affectedFilePaths].sort(),
        quarantinedRuleSignatures: [...state.quarantinedRuleSignatures].sort(),
      };
    })
    .immediate();
}

function applyOneTierBVerificationResult(
  db: Database.Database,
  repo: CallSiteResolutionsRepo,
  findResolution: Database.Statement<[number, string], VerificationDbRow>,
  projectId: number,
  result: CallSiteLspResolutionResult,
  state: TierBApplyState,
  ruleConfigurationSha256: string | null,
): void {
  const current = findEligibleResolution(findResolution, projectId, result);
  if (!current) return;

  const evidenceJson = JSON.stringify({
    kind: "tier-b-site-result",
    ...result,
  });
  if (result.outcome !== "unique-local") {
    appendTierBObservation(repo, projectId, current, null, evidenceJson);
    return;
  }
  if (isProvenTierBMismatch(current, result)) {
    quarantineTierBSignature(
      db,
      repo,
      projectId,
      current,
      result,
      evidenceJson,
      state,
      ruleConfigurationSha256,
    );
    return;
  }
  verifyTierBTarget(db, repo, projectId, current, result, evidenceJson, state);
}

function findEligibleResolution(
  findResolution: Database.Statement<[number, string], VerificationDbRow>,
  projectId: number,
  result: CallSiteLspResolutionResult,
): VerificationDbRow | undefined {
  const current = findResolution.get(projectId, result.callSiteKey);
  if (
    !current ||
    current.source_content_hash !== result.sourceContentHash ||
    current.rule_signature !== result.ruleSignature ||
    current.selected_target_node_key !== result.expectedTargetNodeKey ||
    current.resolution_class !== result.resolutionClass ||
    current.is_stale === 1
  ) {
    return undefined;
  }
  return current;
}

function isProvenTierBMismatch(
  current: VerificationDbRow,
  result: CallSiteLspResolutionResult,
): result is Extract<CallSiteLspResolutionResult, { outcome: "unique-local" }> {
  return (
    result.outcome === "unique-local" &&
    result.expectedTargetNodeKey !== null &&
    result.targetNodeKey !== result.expectedTargetNodeKey &&
    current.resolution_class === CallSiteResolutionClasses.PROVEN &&
    result.verificationPolicyVersion === CALL_SITE_VERIFICATION_POLICY_VERSION
  );
}

function quarantineTierBSignature(
  db: Database.Database,
  repo: CallSiteResolutionsRepo,
  projectId: number,
  current: VerificationDbRow,
  result: Extract<CallSiteLspResolutionResult, { outcome: "unique-local" }>,
  evidenceJson: string,
  state: TierBApplyState,
  ruleConfigurationSha256: string | null,
): void {
  const signatureFiles = db
    .prepare(
      `SELECT DISTINCT file_path
       FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
       WHERE project_id = ? AND rule_signature = ?
       ORDER BY file_path COLLATE BINARY`,
    )
    .all(projectId, current.rule_signature) as Array<{
    file_path: string;
  }>;
  const didQuarantine = db
    .prepare(
      `INSERT OR IGNORE INTO ${SchemaTables.CALL_SITE_RULE_QUARANTINES} (
        project_id, rule_signature, policy_version, reason, call_site_key,
        source_content_hash, expected_target_node_key, observed_target_node_key,
        rule_configuration_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      current.rule_signature,
      result.verificationPolicyVersion,
      CallSiteRuleQuarantineReasons.TIER_B_TARGET_MISMATCH,
      current.call_site_key,
      current.source_content_hash,
      result.expectedTargetNodeKey,
      result.targetNodeKey,
      ruleConfigurationSha256,
    ).changes;
  db.prepare(
    `UPDATE ${SchemaTables.CALL_SITE_RESOLUTIONS}
     SET selected_target_node_key = ?, verification_status = ?,
         verified_target_node_key = ?
     WHERE project_id = ? AND call_site_key = ?`,
  ).run(
    result.targetNodeKey,
    CallSiteVerificationStatuses.CONTRADICTED,
    result.targetNodeKey,
    projectId,
    current.call_site_key,
  );
  appendTierBObservation(
    repo,
    projectId,
    current,
    result.targetNodeKey,
    evidenceJson,
  );
  state.updatedCallSiteKeys.add(current.call_site_key);

  for (const row of signatureFiles) {
    state.affectedFilePaths.add(row.file_path);
  }
  if (didQuarantine > 0) {
    state.quarantinedRuleSignatures.add(current.rule_signature);
  }
}

function verifyTierBTarget(
  db: Database.Database,
  repo: CallSiteResolutionsRepo,
  projectId: number,
  current: VerificationDbRow,
  result: Extract<CallSiteLspResolutionResult, { outcome: "unique-local" }>,
  evidenceJson: string,
  state: TierBApplyState,
): void {
  db.prepare(
    `UPDATE ${SchemaTables.CALL_SITE_RESOLUTIONS}
     SET selected_target_node_key = ?, verification_status = ?,
         verified_target_node_key = ?
     WHERE project_id = ? AND call_site_key = ?`,
  ).run(
    result.targetNodeKey,
    CallSiteVerificationStatuses.VERIFIED,
    result.targetNodeKey,
    projectId,
    current.call_site_key,
  );
  appendTierBObservation(
    repo,
    projectId,
    current,
    result.targetNodeKey,
    evidenceJson,
  );
  state.updatedCallSiteKeys.add(current.call_site_key);
  state.affectedFilePaths.add(current.file_path);
}

function appendTierBObservation(
  repo: CallSiteResolutionsRepo,
  projectId: number,
  current: VerificationDbRow,
  targetNodeKey: string | null,
  evidenceJson: string,
  resolutionClass: CallSiteResolutionClass = current.resolution_class,
): void {
  repo.appendObservation(projectId, {
    callSiteKey: current.call_site_key,
    filePath: current.file_path,
    sourceContentHash: current.source_content_hash,
    source: CallSiteResolutionObservationSources.TIER_B,
    targetNodeKey,
    evidenceJson,
    resolutionClass,
    resolver: "tier-b",
    ruleSignature: current.rule_signature,
  });
}

function validateTierBResults(results: CallSiteLspResolutionResult[]): void {
  if (!Array.isArray(results)) {
    throw invalidInput("Tier B call-site results must be an array");
  }
  const seenCallSiteKeys = new Set<string>();
  for (const result of results) {
    if (!result || typeof result !== "object") {
      throw invalidInput("Tier B call-site result must be an object");
    }
    assertPortableKey(result.callSiteKey);
    assertHash(result.sourceContentHash, "source content hash");
    assertNonEmpty(result.ruleSignature, "rule signature");
    assertNonEmpty(
      result.verificationPolicyVersion,
      "verification policy version",
    );
    if (result.expectedTargetNodeKey !== null) {
      assertNonEmpty(result.expectedTargetNodeKey, "expected target node key");
    }
    assertOneOf(
      result.resolutionClass,
      Object.values(CallSiteResolutionClasses),
      "call-site resolution class",
    );
    assertOneOf(
      result.verificationMode,
      ["tier-b", "canary"],
      "verification mode",
    );
    assertOneOf(
      result.outcome,
      ["unique-local", "no-result", "timeout", "external", "multi-location"],
      "Tier B call-site outcome",
    );
    if (seenCallSiteKeys.has(result.callSiteKey)) {
      throw invalidInput(
        "Tier B results must contain one result per call site",
      );
    }
    seenCallSiteKeys.add(result.callSiteKey);

    if (result.outcome === "unique-local") {
      assertNonEmpty(result.targetNodeKey, "local target node key");
    } else if ("targetNodeKey" in result) {
      throw invalidInput(
        "Only a unique local result may include a target node key",
      );
    }
  }
}

function buildResolutionRecords(
  rows: ResolutionDbRow[],
): CallSiteResolutionRecord[] {
  const result: CallSiteResolutionRecord[] = [];
  let current: CallSiteResolutionRecord | undefined;
  for (const row of rows) {
    if (!current || current.callSiteKey !== row.call_site_key) {
      current = resolutionRecordFromRow(row);
      result.push(current);
    }
    if (hasCandidateFields(row)) {
      current.candidates.push({
        ordinal: row.ordinal,
        targetNodeKey: row.candidate_target_node_key,
        evidenceJson: row.evidence_json,
      });
    }
  }
  return result;
}

function resolutionRecordFromRow(
  row: ResolutionDbRow,
): CallSiteResolutionRecord {
  return {
    callSiteKey: row.call_site_key,
    identityVersion: row.identity_version,
    filePath: row.file_path,
    sourceContentHash: row.source_content_hash,
    startLine: row.start_line,
    startColumn: row.start_column,
    calleeKind: row.callee_kind,
    calleeName: row.callee_name,
    callerNodeKey: row.caller_node_key,
    resolutionClass: row.resolution_class,
    selectedTargetNodeKey: row.selected_target_node_key,
    confidence: row.confidence,
    resolver: row.resolver,
    ruleSignature: row.rule_signature,
    dependencyFingerprint: row.dependency_fingerprint,
    verificationStatus: row.verification_status,
    verifiedTargetNodeKey: row.verified_target_node_key,
    isStale: row.is_stale === 1,
    dependencies: [],
    candidates: [],
  };
}

function hasCandidateFields(row: ResolutionDbRow): row is ResolutionDbRow & {
  ordinal: number;
  candidate_target_node_key: string;
  evidence_json: string;
} {
  return (
    row.ordinal !== null &&
    row.candidate_target_node_key !== null &&
    row.evidence_json !== null
  );
}

function appendResolutionDependencies(
  resolutions: CallSiteResolutionRecord[],
  rows: DependencyDbRow[],
): void {
  const byKey = new Map(
    resolutions.map((resolution) => [resolution.callSiteKey, resolution]),
  );
  for (const row of rows) {
    byKey.get(row.call_site_key)?.dependencies.push({
      ...(row.dependency_kind === CallSiteResolutionDependencyKinds.FILE
        ? {}
        : { kind: row.dependency_kind }),
      filePath: row.dependency_path,
      contentHash: row.content_hash,
    });
  }
}

function normalizeResolutionDependencies(
  resolution: CallSiteResolutionRecord,
): CallSiteResolutionDependency[] {
  if (!Array.isArray(resolution.dependencies)) {
    throw invalidInput("Call-site dependencies must be an array");
  }
  const byKey = normalizeDependencyRows(resolution.dependencies, {
    candidateMemberHashError:
      "Candidate member dependencies must not have a hash",
    duplicateHashError: "Duplicate dependency paths must have the same hash",
  });
  const callerKey = `${CallSiteResolutionDependencyKinds.FILE}\0${resolution.filePath}`;
  const callerDependency = byKey.get(callerKey);
  if (
    callerDependency &&
    callerDependency.contentHash !== resolution.sourceContentHash
  ) {
    throw invalidInput("Caller dependency hash must match source content hash");
  }
  byKey.set(callerKey, {
    filePath: resolution.filePath,
    contentHash: resolution.sourceContentHash,
  });
  return [...byKey.values()].sort(
    (left, right) =>
      (left.kind ?? CallSiteResolutionDependencyKinds.FILE).localeCompare(
        right.kind ?? CallSiteResolutionDependencyKinds.FILE,
      ) || comparePaths(left.filePath, right.filePath),
  );
}

function normalizeChangedDependencies(
  changedDependencies: CallSiteResolutionDependency[],
): CallSiteResolutionDependency[] {
  if (!Array.isArray(changedDependencies)) {
    throw invalidInput("Changed dependencies must be an array");
  }
  const byKey = normalizeDependencyRows(changedDependencies, {
    candidateMemberHashError:
      "Changed candidate member dependencies must not have a hash",
    duplicateHashError: "Changed dependency paths must have one current hash",
  });
  return [...byKey.values()].sort(
    (left, right) =>
      (left.kind ?? CallSiteResolutionDependencyKinds.FILE).localeCompare(
        right.kind ?? CallSiteResolutionDependencyKinds.FILE,
      ) || comparePaths(left.filePath, right.filePath),
  );
}

function normalizeDependencyRows(
  dependencies: CallSiteResolutionDependency[],
  messages: {
    candidateMemberHashError: string;
    duplicateHashError: string;
  },
): Map<string, CallSiteResolutionDependency> {
  const byKey = new Map<string, CallSiteResolutionDependency>();
  for (const dependency of dependencies) {
    const normalized = normalizeDependencyRow(dependency, messages);
    const key = `${normalizeDependencyKind(dependency?.kind)}\0${normalized.filePath}`;
    const prior = byKey.get(key);
    if (prior !== undefined && prior.contentHash !== normalized.contentHash) {
      throw invalidInput(messages.duplicateHashError);
    }
    byKey.set(key, normalized);
  }
  return byKey;
}

function normalizeDependencyRow(
  dependency: CallSiteResolutionDependency,
  messages: { candidateMemberHashError: string },
): CallSiteResolutionDependency {
  const kind = normalizeDependencyKind(dependency?.kind);
  if (kind === CallSiteResolutionDependencyKinds.CANDIDATE_MEMBER) {
    assertCandidateMemberName(dependency?.filePath);
    if (dependency.contentHash !== null)
      throw invalidInput(messages.candidateMemberHashError);
  } else {
    assertWorkspacePath(dependency?.filePath);
  }
  assertNullableHash(dependency.contentHash, "dependency content hash");
  return {
    ...(kind === CallSiteResolutionDependencyKinds.FILE ? {} : { kind }),
    filePath: dependency.filePath,
    contentHash: dependency.contentHash,
  };
}

function normalizeDependencyKind(
  kind: CallSiteResolutionDependency["kind"],
): "file" | "candidate-member" {
  if (kind === undefined || kind === CallSiteResolutionDependencyKinds.FILE)
    return CallSiteResolutionDependencyKinds.FILE;
  if (kind === CallSiteResolutionDependencyKinds.CANDIDATE_MEMBER) return kind;
  throw invalidInput("Unknown call-site dependency kind");
}

function assertCandidateMemberName(
  value: string | undefined,
): asserts value is string {
  if (typeof value !== "string")
    throw invalidInput("Candidate member name must be a string");
  assertNonEmpty(value, "candidate member name");
  if (value.includes("\0"))
    throw invalidInput("Candidate member names must not contain NUL");
}

/** Rebuilds the collapsed `calls` edge projection from current per-site selections.
 * Self-call resolution rows remain persisted, but their graph edges are intentionally omitted. */
function rebuildCallsProjection(
  db: Database.Database,
  projectId: number,
  filePath: string,
): void {
  const callerPaths = JSON.stringify([filePath]);
  db.prepare(
    `DELETE FROM ${SchemaTables.NODE_LINKS}
     WHERE ${SchemaColumns.LINK_TYPE} = ?
       AND ${SchemaColumns.SOURCE_NODE_ID} IN (
         SELECT id FROM ${SchemaTables.L2_NODES}
         WHERE ${SchemaColumns.PROJECT_ID} = ?
           AND ${SchemaColumns.PATH_PATTERNS} = ?
       )`,
  ).run(LinkTypes.CALLS, projectId, callerPaths);

  db.prepare(
    `INSERT INTO ${SchemaTables.NODE_LINKS} (
       ${SchemaColumns.SOURCE_NODE_ID}, ${SchemaColumns.TARGET_NODE_ID}, ${SchemaColumns.LINK_TYPE}
     )
     SELECT DISTINCT caller.id, target.id, ?
     FROM ${SchemaTables.CALL_SITE_RESOLUTIONS} r
     LEFT JOIN ${SchemaTables.CALL_SITE_RESOLUTION_PROJECTION_CALLERS} p
       ON p.project_id = r.project_id AND p.call_site_key = r.call_site_key
     JOIN ${SchemaTables.L2_NODES} caller
       ON caller.${SchemaColumns.PROJECT_ID} = r.project_id
       AND caller.${SchemaColumns.NODE_KEY} = COALESCE(p.caller_node_key, r.caller_node_key)
       AND caller.${SchemaColumns.PATH_PATTERNS} = ?
     JOIN ${SchemaTables.L2_NODES} target
       ON target.${SchemaColumns.PROJECT_ID} = r.project_id
       AND target.${SchemaColumns.NODE_KEY} = r.selected_target_node_key
     WHERE r.project_id = ? AND r.file_path = ?
       AND r.is_stale = 0 AND r.selected_target_node_key IS NOT NULL
       AND caller.id <> target.id
       AND (
         NOT EXISTS (
           SELECT 1 FROM ${SchemaTables.CALL_SITE_RULE_QUARANTINES} q
           WHERE q.project_id = r.project_id
             AND q.rule_signature = r.rule_signature
         )
         OR r.verification_status IN (?, ?)
       )`,
  ).run(
    LinkTypes.CALLS,
    callerPaths,
    projectId,
    filePath,
    CallSiteVerificationStatuses.VERIFIED,
    CallSiteVerificationStatuses.CONTRADICTED,
  );
}

function validateResolutionIdentity(
  requestedFilePath: string,
  resolution: CallSiteResolutionRecord,
): void {
  if (resolution.identityVersion !== 1) {
    throw invalidInput("Call-site identity version must be 1");
  }
  assertWorkspacePath(resolution.filePath);
  if (resolution.filePath !== requestedFilePath) {
    throw invalidInput(
      "Call-site resolution file path must match replacement file",
    );
  }
  assertHash(resolution.sourceContentHash, "source content hash");
  assertHash(resolution.dependencyFingerprint, "dependency fingerprint");
}

function validateResolutionEvidence(
  resolution: CallSiteResolutionRecord,
): void {
  if (!isZeroBasedInteger(resolution.startLine)) {
    throw invalidInput("Call-site start line must be a zero-based integer");
  }
  if (!isZeroBasedInteger(resolution.startColumn)) {
    throw invalidInput(
      "Call-site start column must be a zero-based UTF-16 integer",
    );
  }
  assertNonEmpty(resolution.calleeKind, "callee kind");
  assertNonEmpty(resolution.calleeName, "callee name");
  assertNonEmpty(resolution.callerNodeKey, "caller node key");
  assertNonEmpty(resolution.resolver, "resolver");
  assertNonEmpty(resolution.ruleSignature, "rule signature");
  assertOneOf(
    resolution.resolutionClass,
    Object.values(CallSiteResolutionClasses),
    "resolution class",
  );
}

function validateSelectionAndConfidence(
  resolution: CallSiteResolutionRecord,
): void {
  validateSelectedTarget(resolution);
  validateResolutionConfidence(resolution);
}

function validateSelectedTarget(resolution: CallSiteResolutionRecord): void {
  const hasSelectedTarget =
    resolution.selectedTargetNodeKey !== null &&
    resolution.selectedTargetNodeKey.trim().length > 0;
  const classRequiresSelection =
    resolution.resolutionClass === CallSiteResolutionClasses.PROVEN ||
    resolution.resolutionClass === CallSiteResolutionClasses.LIKELY;
  const hasVerifiedSelection =
    resolution.verificationStatus === CallSiteVerificationStatuses.VERIFIED &&
    hasSelectedTarget &&
    resolution.selectedTargetNodeKey === resolution.verifiedTargetNodeKey;
  if (
    (classRequiresSelection && !hasSelectedTarget) ||
    (!classRequiresSelection && hasSelectedTarget && !hasVerifiedSelection)
  ) {
    throw invalidInput(
      "A selected target requires a proven or likely class or a matching verified Tier B result",
    );
  }
}

function validateResolutionConfidence(
  resolution: CallSiteResolutionRecord,
): void {
  if (resolution.resolutionClass === CallSiteResolutionClasses.LIKELY) {
    if (
      typeof resolution.confidence !== "number" ||
      !Number.isFinite(resolution.confidence) ||
      resolution.confidence < 0 ||
      resolution.confidence > 1
    ) {
      throw invalidInput("A likely class requires confidence between 0 and 1");
    }
  } else if (resolution.confidence !== null) {
    throw invalidInput("Only likely resolutions may have confidence");
  }
}

function validateVerification(resolution: CallSiteResolutionRecord): void {
  assertOneOf(
    resolution.verificationStatus,
    Object.values(CallSiteVerificationStatuses),
    "verification status",
  );
  if (resolution.verificationStatus === "unverified") {
    if (resolution.verifiedTargetNodeKey !== null) {
      throw invalidInput(
        "Unverified resolutions cannot have a verified target",
      );
    }
  } else {
    assertNonEmpty(
      resolution.verifiedTargetNodeKey,
      "verified target node key",
    );
  }
  if (typeof resolution.isStale !== "boolean") {
    throw invalidInput("Call-site stale state must be a boolean");
  }
}

function validateCandidates(candidates: CallSiteResolutionCandidate[]): void {
  if (!Array.isArray(candidates)) {
    throw invalidInput("Call-site candidates must be an array");
  }
  const ordinals = new Set<number>();
  const targets = new Set<string>();
  for (const candidate of candidates) {
    validateCandidate(candidate, ordinals, targets);
  }
}

function validateCandidate(
  candidate: CallSiteResolutionCandidate,
  ordinals: Set<number>,
  targets: Set<string>,
): void {
  if (!isZeroBasedInteger(candidate?.ordinal)) {
    throw invalidInput("Candidate ordinal must be a zero-based integer");
  }
  assertNonEmpty(candidate.targetNodeKey, "candidate target node key");
  if (ordinals.has(candidate.ordinal)) {
    throw invalidInput("Candidate ordinals must be unique per call site");
  }
  if (targets.has(candidate.targetNodeKey)) {
    throw invalidInput("Candidate targets must be unique per call site");
  }
  parseEvidence(candidate.evidenceJson);
  ordinals.add(candidate.ordinal);
  targets.add(candidate.targetNodeKey);
}

function validateObservation(
  observation: CallSiteResolutionObservationInput,
): void {
  assertPortableKey(observation?.callSiteKey);
  assertWorkspacePath(observation.filePath);
  assertHash(observation.sourceContentHash, "source content hash");
  assertOneOf(
    observation.source,
    Object.values(CallSiteResolutionObservationSources),
    "observation source",
  );
  if (observation.targetNodeKey !== null) {
    assertNonEmpty(observation.targetNodeKey, "observation target node key");
  }
  if (observation.resolutionClass != null) {
    assertOneOf(
      observation.resolutionClass,
      Object.values(CallSiteResolutionClasses),
      "observation resolution class",
    );
  }
  if (observation.resolver != null) {
    assertNonEmpty(observation.resolver, "observation resolver");
  }
  if (observation.ruleSignature != null) {
    assertNonEmpty(observation.ruleSignature, "observation rule signature");
  }
  parseEvidence(observation.evidenceJson);
}

function assertProjectId(projectId: number): void {
  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    throw invalidInput("Project id must be a positive integer");
  }
}

function assertPortableKey(callSiteKey: string | undefined): void {
  if (!callSiteKey || !/^call-site:v1:[a-f0-9]{64}$/.test(callSiteKey)) {
    throw invalidInput(
      "Call-site key must be a version 1 portable SHA-256 key",
    );
  }
}

function assertWorkspacePath(filePath: string): void {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.startsWith("/") ||
    filePath.endsWith("/") ||
    filePath.includes("\\") ||
    filePath.includes("\0") ||
    /^[a-zA-Z]:/.test(filePath) ||
    filePath
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw invalidInput(
      "File path must be a normalized workspace-relative POSIX path",
    );
  }
}

function assertHash(value: string, name: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw invalidInput(`${name} must be a lowercase SHA-256 hex digest`);
  }
}

function validateQuarantineClearRequest(
  ruleSignature: string,
  request: CallSiteRuleQuarantineClearRequest,
): void {
  assertNonEmpty(ruleSignature, "rule signature");
  if (!request || typeof request !== "object") {
    throw invalidInput("Quarantine clear request is required");
  }
  assertHash(request.newRuleConfigurationSha256, "new rule configuration hash");
  if (!request.evidence || typeof request.evidence !== "object") {
    throw invalidInput("Quarantine clear evidence is required");
  }
  if (request.evidence.kind === "certification") {
    assertHash(request.evidence.evidenceSha256, "certification evidence hash");
    assertCanonicalTimestamp(request.evidence.resultsRecordedAt);
    return;
  }
  if (request.evidence.kind === "operator") {
    assertNonEmpty(request.evidence.operator, "operator identity");
    assertNonEmpty(request.evidence.reason, "operator reason");
    if (request.evidence.operator.trim().length > 200) {
      throw invalidInput("Operator identity must be at most 200 characters");
    }
    if (request.evidence.reason.trim().length > 2_000) {
      throw invalidInput("Operator reason must be at most 2000 characters");
    }
    return;
  }
  throw invalidInput("Unsupported quarantine clear evidence kind");
}

function assertCanonicalTimestamp(value: string): void {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    throw invalidInput(
      "Certification results timestamp must be canonical ISO-8601",
    );
  }
}

function clearRuleQuarantineInTransaction(
  db: Database.Database,
  projectId: number,
  ruleSignature: string,
  request: CallSiteRuleQuarantineClearRequest,
): CallSiteRuleQuarantineClearResult {
  const active = readActiveQuarantine(db, projectId, ruleSignature);
  if (!active) {
    const priorClear = readPriorQuarantineClear(db, projectId, ruleSignature);
    if (priorClear) return priorClear;
    throw invalidQuarantineClear(
      `No active quarantine exists for rule signature ${ruleSignature}`,
    );
  }

  const clearedAt = new Date().toISOString();
  const previousConfigurationSha256 = validateQuarantineClearCanProceed(
    active,
    request,
    clearedAt,
  );
  const auditId = insertQuarantineClearAudit(
    db,
    projectId,
    active,
    request,
    clearedAt,
    previousConfigurationSha256,
  );
  removeActiveQuarantine(db, projectId, ruleSignature);
  const audit = readQuarantineClearAudit(db, auditId);
  if (!audit) {
    throw new Error("Inserted quarantine clear audit row could not be read");
  }
  return { status: "cleared", audit: mapQuarantineClearAudit(audit) };
}

function readActiveQuarantine(
  db: Database.Database,
  projectId: number,
  ruleSignature: string,
): QuarantineDbRow | undefined {
  return db
    .prepare(
      `SELECT project_id, rule_signature, policy_version, reason,
              call_site_key, source_content_hash, expected_target_node_key,
              observed_target_node_key, rule_configuration_sha256, created_at
       FROM ${SchemaTables.CALL_SITE_RULE_QUARANTINES}
       WHERE project_id = ? AND rule_signature = ?`,
    )
    .get(projectId, ruleSignature) as QuarantineDbRow | undefined;
}

function readPriorQuarantineClear(
  db: Database.Database,
  projectId: number,
  ruleSignature: string,
): CallSiteRuleQuarantineClearResult | undefined {
  const row = db
    .prepare(
      `SELECT ${QUARANTINE_CLEAR_AUDIT_COLUMNS}
       FROM ${SchemaTables.CALL_SITE_RULE_QUARANTINE_CLEAR_AUDITS}
       WHERE project_id = ? AND rule_signature = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(projectId, ruleSignature) as QuarantineClearAuditDbRow | undefined;
  return row
    ? { status: "already-cleared", audit: mapQuarantineClearAudit(row) }
    : undefined;
}

function validateQuarantineClearCanProceed(
  active: QuarantineDbRow,
  request: CallSiteRuleQuarantineClearRequest,
  clearedAt: string,
): string {
  const previousConfigurationSha256 = active.rule_configuration_sha256;
  if (!previousConfigurationSha256) {
    throw invalidQuarantineClear(
      "The quarantine's historical configuration hash is unavailable; it cannot be cleared safely",
    );
  }
  if (request.newRuleConfigurationSha256 === previousConfigurationSha256) {
    throw invalidQuarantineClear(
      "The rule configuration hash must change before clearing quarantine",
    );
  }

  const evidenceTime =
    request.evidence.kind === "certification"
      ? request.evidence.resultsRecordedAt
      : clearedAt;
  const quarantineCreatedAtMs = sqliteTimestampMs(active.created_at);
  if (
    !Number.isFinite(quarantineCreatedAtMs) ||
    Date.parse(evidenceTime) <= quarantineCreatedAtMs
  ) {
    throw invalidQuarantineClear(
      "Clear evidence must be strictly newer than the quarantine",
    );
  }
  return previousConfigurationSha256;
}

function insertQuarantineClearAudit(
  db: Database.Database,
  projectId: number,
  active: QuarantineDbRow,
  request: CallSiteRuleQuarantineClearRequest,
  clearedAt: string,
  previousConfigurationSha256: string,
): number {
  const evidence = getQuarantineClearEvidenceColumns(request);
  const result = db
    .prepare(
      `INSERT INTO ${SchemaTables.CALL_SITE_RULE_QUARANTINE_CLEAR_AUDITS} (
        project_id, rule_signature, quarantine_policy_version,
        quarantine_reason, quarantine_call_site_key,
        quarantine_source_content_hash, expected_target_node_key,
        observed_target_node_key, quarantine_created_at, cleared_at,
        clear_method, evidence_sha256, operator, reason,
        previous_rule_configuration_sha256, new_rule_configuration_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      active.rule_signature,
      active.policy_version,
      active.reason,
      active.call_site_key,
      active.source_content_hash,
      active.expected_target_node_key,
      active.observed_target_node_key,
      active.created_at,
      clearedAt,
      request.evidence.kind,
      evidence.evidenceSha256,
      evidence.operator,
      evidence.reason,
      previousConfigurationSha256,
      request.newRuleConfigurationSha256,
    );
  return Number(result.lastInsertRowid);
}

function getQuarantineClearEvidenceColumns(
  request: CallSiteRuleQuarantineClearRequest,
): {
  evidenceSha256: string | null;
  operator: string | null;
  reason: string | null;
} {
  if (request.evidence.kind === "certification") {
    return {
      evidenceSha256: request.evidence.evidenceSha256,
      operator: null,
      reason: null,
    };
  }
  return {
    evidenceSha256: null,
    operator: request.evidence.operator,
    reason: request.evidence.reason,
  };
}

function removeActiveQuarantine(
  db: Database.Database,
  projectId: number,
  ruleSignature: string,
): void {
  const deleted = db
    .prepare(
      `DELETE FROM ${SchemaTables.CALL_SITE_RULE_QUARANTINES}
       WHERE project_id = ? AND rule_signature = ?`,
    )
    .run(projectId, ruleSignature).changes;
  if (deleted !== 1) {
    throw invalidQuarantineClear(
      "The active quarantine changed while it was being cleared",
    );
  }
}

function readQuarantineClearAudit(
  db: Database.Database,
  id: number,
): QuarantineClearAuditDbRow | undefined {
  return db
    .prepare(
      `SELECT ${QUARANTINE_CLEAR_AUDIT_COLUMNS}
       FROM ${SchemaTables.CALL_SITE_RULE_QUARANTINE_CLEAR_AUDITS}
       WHERE id = ?`,
    )
    .get(id) as QuarantineClearAuditDbRow | undefined;
}

function mapQuarantineClearAudit(
  row: QuarantineClearAuditDbRow,
): CallSiteRuleQuarantineClearAudit {
  return {
    id: row.id,
    ruleSignature: row.rule_signature,
    quarantinePolicyVersion: row.quarantine_policy_version,
    quarantineReason: row.quarantine_reason,
    quarantineCallSiteKey: row.quarantine_call_site_key,
    quarantineSourceContentHash: row.quarantine_source_content_hash,
    expectedTargetNodeKey: row.expected_target_node_key,
    observedTargetNodeKey: row.observed_target_node_key,
    quarantineCreatedAt: row.quarantine_created_at,
    clearedAt: row.cleared_at,
    method: row.clear_method,
    evidenceSha256: row.evidence_sha256,
    operator: row.operator,
    reason: row.reason,
    previousRuleConfigurationSha256: row.previous_rule_configuration_sha256,
    newRuleConfigurationSha256: row.new_rule_configuration_sha256,
  };
}

function invalidQuarantineClear(message: string): DocuviaError {
  return new DocuviaError(ErrorCodes.INVALID_INPUT, message);
}

function sqliteTimestampMs(value: string): number {
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

function assertNullableHash(value: string | null, name: string): void {
  if (value !== null) assertHash(value, name);
}

function assertNonEmpty(value: string | null, name: string): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.includes("\0")
  ) {
    throw invalidInput(`${name} must be a non-empty string`);
  }
}

function assertOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  name: string,
): asserts value is T {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw invalidInput(`Unsupported ${name}`);
  }
}

function isZeroBasedInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseEvidence(evidenceJson: string): void {
  if (typeof evidenceJson !== "string") {
    throw invalidInput("Evidence must be serialized JSON");
  }
  try {
    JSON.parse(evidenceJson);
  } catch {
    throw invalidInput("Evidence must be valid JSON");
  }
}

function invalidInput(message: string): DocuviaError {
  return new DocuviaError(ErrorCodes.INVALID_INPUT, message);
}
