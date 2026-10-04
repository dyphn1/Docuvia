import type Database from "better-sqlite3";
import {
  CallSiteResolutionClasses,
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
  CallSiteResolutionObservation,
  CallSiteResolutionObservationInput,
  CallSiteResolutionRecord,
  CallSiteLspResolutionResult,
  CallSiteRuleQuarantine,
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
  APPLY_TIER_B_RESULTS_FAILED: (projectId: number) =>
    `Failed to apply Tier B verification results for project ${projectId}`,
  READ_RULE_QUARANTINES_FAILED: (projectId: number) =>
    `Failed to read call-site rule quarantines for project ${projectId}`,
} as const;

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

interface DependencyDbRow {
  call_site_key: string;
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
  ): void {
    assertProjectId(projectId);
    assertWorkspacePath(filePath);
    if (!Array.isArray(resolutions)) {
      throw invalidInput("Call-site resolutions must be an array");
    }
    for (const resolution of resolutions) {
      validateResolution(filePath, resolution);
    }

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
          const insertDependency = this.db.prepare(
            `INSERT INTO ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} (
              project_id, call_site_key, dependency_path, content_hash
            ) VALUES (?, ?, ?, ?)`,
          );

          for (const resolution of resolutions) {
            const currentResolution = applyLocalRuleQuarantine(
              this.db,
              projectId,
              resolution,
            );
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
            for (const dependency of normalizeResolutionDependencies(
              currentResolution,
            )) {
              insertDependency.run(
                projectId,
                currentResolution.callSiteKey,
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

      const result: CallSiteResolutionRecord[] = [];
      let current: CallSiteResolutionRecord | undefined;
      for (const row of rows) {
        if (!current || current.callSiteKey !== row.call_site_key) {
          current = {
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
          result.push(current);
        }
        if (
          row.ordinal !== null &&
          row.candidate_target_node_key !== null &&
          row.evidence_json !== null
        ) {
          current.candidates.push({
            ordinal: row.ordinal,
            targetNodeKey: row.candidate_target_node_key,
            evidenceJson: row.evidence_json,
          });
        }
      }
      const dependencyRows = this.db
        .prepare(
          `SELECT d.call_site_key, d.dependency_path, d.content_hash
           FROM ${SchemaTables.CALL_SITE_RESOLUTION_DEPENDENCIES} d
           JOIN ${SchemaTables.CALL_SITE_RESOLUTIONS} r
             ON r.project_id = d.project_id AND r.call_site_key = d.call_site_key
           WHERE r.project_id = ? AND r.file_path = ?
           ORDER BY d.call_site_key COLLATE BINARY, d.dependency_path COLLATE BINARY`,
        )
        .all(projectId, filePath) as DependencyDbRow[];
      const byKey = new Map(
        result.map((resolution) => [resolution.callSiteKey, resolution]),
      );
      for (const row of dependencyRows) {
        byKey.get(row.call_site_key)?.dependencies.push({
          filePath: row.dependency_path,
          contentHash: row.content_hash,
        });
      }
      return result;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        CALL_SITE_RESOLUTIONS_ERRORS.READ_FILE_FAILED(projectId, filePath),
        err,
      );
    }
  }

  applyTierBVerificationResults(
    projectId: number,
    results: CallSiteLspResolutionResult[],
  ): CallSiteVerificationApplyResult {
    assertProjectId(projectId);
    validateTierBResults(results);
    try {
      return applyTierBVerificationResultsTransaction(
        this.db,
        this,
        projectId,
        results,
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
                  observed_target_node_key, created_at
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

  invalidateChangedDependencies(
    projectId: number,
    changedDependencies: CallSiteResolutionDependency[],
  ): number {
    assertProjectId(projectId);
    const dependencies = normalizeChangedDependencies(changedDependencies);
    if (dependencies.length === 0) return 0;

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
                   AND d.dependency_path = ?
                   AND d.content_hash IS NOT ?
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
                   AND d.dependency_path = ?
                   AND d.content_hash IS NOT ?
               )`,
          );
          let newlyStale = 0;
          const affectedFiles = new Set<string>();
          for (const dependency of dependencies) {
            for (const { file_path: filePath } of findAffectedFiles.all(
              projectId,
              dependency.filePath,
              dependency.contentHash,
            ) as Array<{ file_path: string }>) {
              affectedFiles.add(filePath);
            }
            newlyStale += markStale.run(
              projectId,
              dependency.filePath,
              dependency.contentHash,
            ).changes;
          }
          for (const filePath of affectedFiles) {
            rebuildCallsProjection(this.db, projectId, filePath);
          }
          return newlyStale;
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

function applyLocalRuleQuarantine(
  db: Database.Database,
  projectId: number,
  resolution: CallSiteResolutionRecord,
): CallSiteResolutionRecord {
  const quarantine = db
    .prepare(
      `SELECT call_site_key, source_content_hash, observed_target_node_key
       FROM ${SchemaTables.CALL_SITE_RULE_QUARANTINES}
       WHERE project_id = ? AND rule_signature = ?`,
    )
    .get(projectId, resolution.ruleSignature) as
    | {
        call_site_key: string;
        source_content_hash: string;
        observed_target_node_key: string;
      }
    | undefined;
  if (!quarantine) return resolution;

  const isContradictionSite =
    resolution.callSiteKey === quarantine.call_site_key &&
    resolution.sourceContentHash === quarantine.source_content_hash;
  return {
    ...resolution,
    resolutionClass: CallSiteResolutionClasses.AMBIGUOUS,
    selectedTargetNodeKey: null,
    confidence: null,
    verificationStatus: isContradictionSite
      ? CallSiteVerificationStatuses.CONTRADICTED
      : CallSiteVerificationStatuses.UNVERIFIED,
    verifiedTargetNodeKey: isContradictionSite
      ? quarantine.observed_target_node_key
      : null,
  };
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
): void {
  const signatureRows = db
    .prepare(
      `SELECT call_site_key, file_path, source_content_hash
       FROM ${SchemaTables.CALL_SITE_RESOLUTIONS}
       WHERE project_id = ? AND rule_signature = ?
       ORDER BY file_path COLLATE BINARY, call_site_key COLLATE BINARY`,
    )
    .all(projectId, current.rule_signature) as Array<{
    call_site_key: string;
    file_path: string;
    source_content_hash: string;
  }>;
  const didQuarantine = db
    .prepare(
      `INSERT OR IGNORE INTO ${SchemaTables.CALL_SITE_RULE_QUARANTINES} (
        project_id, rule_signature, policy_version, reason, call_site_key,
        source_content_hash, expected_target_node_key, observed_target_node_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ).changes;
  markSignatureAmbiguous(db, projectId, current, result.targetNodeKey);

  for (const row of signatureRows) {
    state.affectedFilePaths.add(row.file_path);
    state.updatedCallSiteKeys.add(row.call_site_key);
    if (row.call_site_key !== current.call_site_key) {
      appendQuarantineObservation(repo, projectId, current, result, row);
    }
  }
  appendTierBObservation(
    repo,
    projectId,
    current,
    result.targetNodeKey,
    evidenceJson,
    CallSiteResolutionClasses.AMBIGUOUS,
  );
  if (didQuarantine > 0) {
    state.quarantinedRuleSignatures.add(current.rule_signature);
  }
}

function markSignatureAmbiguous(
  db: Database.Database,
  projectId: number,
  current: VerificationDbRow,
  observedTargetNodeKey: string,
): void {
  db.prepare(
    `UPDATE ${SchemaTables.CALL_SITE_RESOLUTIONS}
     SET resolution_class = ?, selected_target_node_key = NULL,
         confidence = NULL, verification_status = ?, verified_target_node_key = NULL
     WHERE project_id = ? AND rule_signature = ?`,
  ).run(
    CallSiteResolutionClasses.AMBIGUOUS,
    CallSiteVerificationStatuses.UNVERIFIED,
    projectId,
    current.rule_signature,
  );
  db.prepare(
    `UPDATE ${SchemaTables.CALL_SITE_RESOLUTIONS}
     SET verification_status = ?, verified_target_node_key = ?
     WHERE project_id = ? AND call_site_key = ?`,
  ).run(
    CallSiteVerificationStatuses.CONTRADICTED,
    observedTargetNodeKey,
    projectId,
    current.call_site_key,
  );
}

function appendQuarantineObservation(
  repo: CallSiteResolutionsRepo,
  projectId: number,
  current: VerificationDbRow,
  result: Extract<CallSiteLspResolutionResult, { outcome: "unique-local" }>,
  row: {
    call_site_key: string;
    file_path: string;
    source_content_hash: string;
  },
): void {
  repo.appendObservation(projectId, {
    callSiteKey: row.call_site_key,
    filePath: row.file_path,
    sourceContentHash: row.source_content_hash,
    source: CallSiteResolutionObservationSources.TIER_B,
    targetNodeKey: null,
    evidenceJson: JSON.stringify({
      kind: "tier-b-signature-quarantined",
      ruleSignature: current.rule_signature,
      policyVersion: result.verificationPolicyVersion,
      reason: CallSiteRuleQuarantineReasons.TIER_B_TARGET_MISMATCH,
      triggerCallSiteKey: current.call_site_key,
    }),
    resolutionClass: CallSiteResolutionClasses.AMBIGUOUS,
    resolver: "local-rule-quarantine",
    ruleSignature: current.rule_signature,
  });
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
    assertNonEmpty(result.expectedTargetNodeKey, "expected target node key");
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

function normalizeResolutionDependencies(
  resolution: CallSiteResolutionRecord,
): CallSiteResolutionDependency[] {
  if (!Array.isArray(resolution.dependencies)) {
    throw invalidInput("Call-site dependencies must be an array");
  }
  const byPath = new Map<string, string | null>();
  for (const dependency of resolution.dependencies) {
    assertWorkspacePath(dependency?.filePath);
    assertNullableHash(dependency.contentHash, "dependency content hash");
    const priorHash = byPath.get(dependency.filePath);
    if (
      byPath.has(dependency.filePath) &&
      priorHash !== dependency.contentHash
    ) {
      throw invalidInput("Duplicate dependency paths must have the same hash");
    }
    byPath.set(dependency.filePath, dependency.contentHash);
  }

  const callerHash = byPath.get(resolution.filePath);
  if (
    byPath.has(resolution.filePath) &&
    callerHash !== resolution.sourceContentHash
  ) {
    throw invalidInput("Caller dependency hash must match source content hash");
  }
  byPath.set(resolution.filePath, resolution.sourceContentHash);
  return [...byPath]
    .sort(([left], [right]) => comparePaths(left, right))
    .map(([filePath, contentHash]) => ({ filePath, contentHash }));
}

function normalizeChangedDependencies(
  changedDependencies: CallSiteResolutionDependency[],
): CallSiteResolutionDependency[] {
  if (!Array.isArray(changedDependencies)) {
    throw invalidInput("Changed dependencies must be an array");
  }
  const byPath = new Map<string, string | null>();
  for (const dependency of changedDependencies) {
    assertWorkspacePath(dependency?.filePath);
    assertNullableHash(dependency.contentHash, "dependency content hash");
    if (
      byPath.has(dependency.filePath) &&
      byPath.get(dependency.filePath) !== dependency.contentHash
    ) {
      throw invalidInput("Changed dependency paths must have one current hash");
    }
    byPath.set(dependency.filePath, dependency.contentHash);
  }
  return [...byPath]
    .sort(([left], [right]) => comparePaths(left, right))
    .map(([filePath, contentHash]) => ({ filePath, contentHash }));
}

/** Rebuilds the collapsed `calls` edge projection from current per-site selections. */
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
     JOIN ${SchemaTables.L2_NODES} caller
       ON caller.${SchemaColumns.PROJECT_ID} = r.project_id
       AND caller.${SchemaColumns.NODE_KEY} = r.caller_node_key
       AND caller.${SchemaColumns.PATH_PATTERNS} = ?
     JOIN ${SchemaTables.L2_NODES} target
       ON target.${SchemaColumns.PROJECT_ID} = r.project_id
       AND target.${SchemaColumns.NODE_KEY} = r.selected_target_node_key
     WHERE r.project_id = ? AND r.file_path = ?
       AND r.is_stale = 0 AND r.selected_target_node_key IS NOT NULL`,
  ).run(LinkTypes.CALLS, callerPaths, projectId, filePath);
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
  const hasSelectedTarget =
    resolution.selectedTargetNodeKey !== null &&
    resolution.selectedTargetNodeKey.trim().length > 0;
  const requiresSelection =
    resolution.resolutionClass === CallSiteResolutionClasses.PROVEN ||
    resolution.resolutionClass === CallSiteResolutionClasses.LIKELY;
  if (hasSelectedTarget !== requiresSelection) {
    throw invalidInput(
      "Only proven or likely resolutions may select a target, and both require one",
    );
  }
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
