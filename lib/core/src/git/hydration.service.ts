import path from "node:path";
import type {
  HydrationResult,
  IGitProvider,
  IGraphStore,
  IHydrationService,
  ILogger,
  SnapshotMetadata,
  SnapshotCallSiteRow,
  SnapshotCallResolutionRow,
} from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import {
  DYNAMIC_DEPENDENCY_EVIDENCE_META_KEY_PREFIX,
  GitConstants,
  KNOWLEDGE_SNAPSHOT_FORMAT_VERSION,
  parseSourceTrailer,
  SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX,
  SNAPSHOT_CALL_SITES_JSONL_FILE_NAME,
  SNAPSHOT_CALL_SITES_VERSION,
  SNAPSHOT_CALL_RESOLUTIONS_AVAILABILITY_META_KEY_PREFIX,
  SNAPSHOT_CALL_RESOLUTIONS_JSONL_FILE_NAME,
  SNAPSHOT_CALL_RESOLUTIONS_VERSION,
  CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX,
  CallsProjectionCallerPolicies,
  isCallsProjectionCallerPolicy,
  SNAPSHOT_CALLS_PROJECTION_CALLER_POLICY_VERSION,
  SNAPSHOT_DYNAMIC_EVIDENCE_VERSION,
  SnapshotCallSiteAvailabilityStates,
  SnapshotCallResolutionAvailabilityStates,
  CallSiteResolutionClasses,
  CallSiteVerificationStatuses,
} from "@workspace/contracts";
import { GitMessages } from "./git-constants.js";
import { importL3CardsFromKnowledgeBranch } from "./l3-import.service.js";
import { readDynamicDependencyEvidenceState } from "../impact/dynamic-dependency-evidence.js";

/** Bounds the source-HEAD ancestry walk during nearest-ancestor resolution. */
const SOURCE_ANCESTRY_WALK_LIMIT = 2000;
/** Below this many current nodes, the shrink guard never triggers -- a tiny/test-scale graph
 *  swinging in size between hydrations is normal and low-stakes. Unvalidated; tune if real
 *  usage shows it's off (matches this file's own DEFAULT_TIER_B_COMMIT_CAP_BYTES precedent for
 *  an honestly-unvalidated heuristic constant). */
const MIN_NODES_FOR_SHRINK_GUARD = 50;
/** Refuses an automatic (non-force) hydrate that would drop total node count below this
 *  fraction of what's already in local.db. Unvalidated; a >90% reduction (this session's
 *  reported case) is nowhere near this threshold either way. */
const SHRINK_GUARD_MAX_RATIO = 0.5;

interface RenderedNode {
  id: string;
  type: "file" | "symbol";
  name: string;
  filePath?: string;
}

interface RenderedEdge {
  source: string;
  target: string;
  type: string;
}

interface ParsedSnapshotMetadata {
  project?: SnapshotMetadata["project"];
  files: SnapshotMetadata["files"];
  lastIngestedSourceSha?: string;
  snapshotVersion?: unknown;
  capabilities?: unknown;
}

function parseNodesJsonl(
  raw: string | undefined,
): Array<{ nodeKey: string; name: string; filePath?: string }> {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const node = JSON.parse(line) as RenderedNode;
      return { nodeKey: node.id, name: node.name, filePath: node.filePath };
    });
}

function parseEdgesJsonl(
  raw: string | undefined,
): Array<{ source: string; target: string; type: string }> {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RenderedEdge);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isNonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.includes("\0")
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSnapshotCallSiteRow(value: unknown): value is SnapshotCallSiteRow {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.filePath) &&
    isNonEmptyString(value.targetFunction) &&
    isNonNegativeSafeInteger(value.startLine) &&
    isNonNegativeSafeInteger(value.startColumn) &&
    isNullableString(value.calleeName) &&
    isNullableString(value.receiverText) &&
    isNullableString(value.calleeKind)
  );
}

function parseCallSitesJsonl(
  raw: string | undefined,
): SnapshotCallSiteRow[] | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim() === "") return [];

  const rows: unknown[] = [];
  try {
    for (const line of raw
      .split("\n")
      .filter((item) => item.trim().length > 0)) {
      rows.push(JSON.parse(line) as unknown);
    }
  } catch {
    return undefined;
  }
  return rows.every(isSnapshotCallSiteRow)
    ? (rows as SnapshotCallSiteRow[])
    : undefined;
}

function isValidResolutionCandidate(candidate: unknown): boolean {
  if (!isRecord(candidate)) return false;
  return (
    isNonEmptyString(candidate.targetNodeKey) &&
    isNonNegativeSafeInteger(candidate.ordinal) &&
    typeof candidate.evidenceJson === "string" &&
    isValidJson(candidate.evidenceJson)
  );
}

function hasValidResolutionCandidates(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.candidates)) return false;
  if (!value.candidates.every(isValidResolutionCandidate)) return false;
  const candidates = value.candidates as Record<string, unknown>[];
  return (
    new Set(candidates.map((candidate) => candidate.ordinal)).size ===
      candidates.length &&
    new Set(candidates.map((candidate) => candidate.targetNodeKey)).size ===
      candidates.length
  );
}

function isValidResolutionDependency(dependency: unknown): boolean {
  return (
    isRecord(dependency) &&
    isWorkspaceRelativePath(dependency.filePath) &&
    isNullableHash(dependency.contentHash)
  );
}

function hasValidResolutionDependencies(
  value: Record<string, unknown>,
): boolean {
  if (!Array.isArray(value.dependencies)) return false;
  if (!value.dependencies.every(isValidResolutionDependency)) return false;
  const dependencies = value.dependencies as Record<string, unknown>[];
  return (
    new Set(dependencies.map((dependency) => dependency.filePath)).size ===
    dependencies.length
  );
}

function isValidResolutionVerification(
  value: Record<string, unknown>,
): boolean {
  const statuses = Object.values(CallSiteVerificationStatuses) as string[];
  if (
    typeof value.verificationStatus !== "string" ||
    !statuses.includes(value.verificationStatus)
  ) {
    return false;
  }
  return value.verificationStatus === CallSiteVerificationStatuses.UNVERIFIED
    ? value.verifiedTargetNodeKey === null
    : isNonEmptyString(value.verifiedTargetNodeKey);
}

function isValidResolutionSelection(value: Record<string, unknown>): boolean {
  const classes = Object.values(CallSiteResolutionClasses) as string[];
  if (
    typeof value.resolutionClass !== "string" ||
    !classes.includes(value.resolutionClass)
  ) {
    return false;
  }
  const hasSelectedTarget = isNonEmptyString(value.selectedTargetNodeKey);
  if (
    value.resolutionClass === CallSiteResolutionClasses.PROVEN ||
    value.resolutionClass === CallSiteResolutionClasses.LIKELY
  ) {
    return hasSelectedTarget;
  }
  return (
    !hasSelectedTarget ||
    (value.verificationStatus === CallSiteVerificationStatuses.VERIFIED &&
      value.selectedTargetNodeKey === value.verifiedTargetNodeKey)
  );
}

function isValidResolutionConfidence(value: Record<string, unknown>): boolean {
  if (value.resolutionClass !== CallSiteResolutionClasses.LIKELY) {
    return value.confidence === null;
  }
  return (
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1
  );
}

function isValidPortableCallSiteKey(value: Record<string, unknown>): boolean {
  return (
    typeof value.callSiteKey === "string" &&
    /^call-site:v1:[a-f0-9]{64}$/.test(value.callSiteKey) &&
    value.identityVersion === 1
  );
}

function isValidResolutionSourceLocation(
  value: Record<string, unknown>,
): boolean {
  return (
    isWorkspaceRelativePath(value.filePath) &&
    isHash(value.sourceContentHash) &&
    isNonNegativeSafeInteger(value.startLine) &&
    isNonNegativeSafeInteger(value.startColumn) &&
    isNonEmptyString(value.calleeKind) &&
    isNonEmptyString(value.calleeName) &&
    isNonEmptyString(value.callerNodeKey) &&
    (value.projectionCallerNodeKey === null ||
      isNonEmptyString(value.projectionCallerNodeKey))
  );
}

function isValidResolutionIdentity(value: Record<string, unknown>): boolean {
  return (
    isValidPortableCallSiteKey(value) && isValidResolutionSourceLocation(value)
  );
}

function isValidResolutionEvidence(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.resolver) &&
    isNonEmptyString(value.ruleSignature) &&
    isHash(value.dependencyFingerprint) &&
    hasValidResolutionDependencies(value) &&
    hasValidResolutionCandidates(value)
  );
}

function isSnapshotCallResolutionRow(
  value: unknown,
): value is SnapshotCallResolutionRow {
  if (!isRecord(value)) return false;
  return (
    isValidSnapshotResolutionOutput(value) && isValidResolutionEvidence(value)
  );
}

function isValidSnapshotResolutionOutput(
  value: Record<string, unknown>,
): boolean {
  return (
    isValidResolutionIdentity(value) &&
    isValidResolutionSelection(value) &&
    isValidResolutionConfidence(value) &&
    isValidResolutionVerification(value) &&
    (value.selectedTargetNodeKey === null ||
      isNonEmptyString(value.selectedTargetNodeKey)) &&
    (value.verifiedTargetNodeKey === null ||
      isNonEmptyString(value.verifiedTargetNodeKey)) &&
    typeof value.isStale === "boolean"
  );
}

function isWorkspaceRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !/^[a-zA-Z]:/.test(value) &&
    value
      .split("/")
      .every(
        (segment) => segment.length > 0 && segment !== "." && segment !== "..",
      )
  );
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNullableHash(value: unknown): value is string | null {
  return value === null || isHash(value);
}

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value) as unknown;
    return true;
  } catch {
    return false;
  }
}

function parseCallResolutionsJsonl(
  raw: string | undefined,
): SnapshotCallResolutionRow[] | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim() === "") return [];
  const rows: unknown[] = [];
  try {
    for (const line of raw
      .split("\n")
      .filter((item) => item.trim().length > 0)) {
      rows.push(JSON.parse(line) as unknown);
    }
  } catch {
    return undefined;
  }
  if (!rows.every(isSnapshotCallResolutionRow)) return undefined;
  const typedRows = rows as SnapshotCallResolutionRow[];
  return new Set(typedRows.map((row) => row.callSiteKey)).size ===
    typedRows.length
    ? typedRows
    : undefined;
}

function parseSnapshotMetadata(
  raw: string | undefined,
): ParsedSnapshotMetadata | undefined {
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return { files: [] };

  const projectValue = parsed.project;
  const project =
    isRecord(projectValue) &&
    typeof projectValue.name === "string" &&
    typeof projectValue.repoUrl === "string"
      ? { name: projectValue.name, repoUrl: projectValue.repoUrl }
      : undefined;

  const files = Array.isArray(parsed.files)
    ? parsed.files.flatMap((value) => {
        if (!isRecord(value) || typeof value.filePath !== "string") return [];
        return [
          {
            filePath: value.filePath,
            contentHash: nullableString(value.contentHash),
            lastTierBProcessedAt: nullableString(value.lastTierBProcessedAt),
            lastTierBCommitSha: nullableString(value.lastTierBCommitSha),
          },
        ];
      })
    : [];

  return {
    project,
    files,
    lastIngestedSourceSha:
      typeof parsed.lastIngestedSourceSha === "string"
        ? parsed.lastIngestedSourceSha
        : undefined,
    snapshotVersion: parsed.snapshotVersion,
    capabilities: parsed.capabilities,
  };
}

function getSnapshotDynamicEvidence(
  metadata: ParsedSnapshotMetadata | undefined,
): unknown | undefined {
  if (metadata?.snapshotVersion !== KNOWLEDGE_SNAPSHOT_FORMAT_VERSION) {
    return undefined;
  }
  if (!isRecord(metadata.capabilities)) return undefined;
  return metadata.capabilities.dynamicDependencyEvidence;
}

function isVersionedDynamicEvidence(
  value: unknown,
): value is { version: number; payload: string } {
  return (
    isRecord(value) &&
    value.version === SNAPSHOT_DYNAMIC_EVIDENCE_VERSION &&
    typeof value.payload === "string"
  );
}

function isSnapshotCallSitesPayloadAvailable(
  metadata: ParsedSnapshotMetadata | undefined,
  callSites: SnapshotCallSiteRow[] | undefined,
): boolean {
  if (metadata?.snapshotVersion !== KNOWLEDGE_SNAPSHOT_FORMAT_VERSION) {
    return false;
  }
  if (!isRecord(metadata.capabilities)) return false;
  const callSitesCapability = metadata.capabilities.callSites;
  return (
    isRecord(callSitesCapability) &&
    callSitesCapability.version === SNAPSHOT_CALL_SITES_VERSION &&
    callSites !== undefined
  );
}

function isSnapshotCallResolutionsPayloadAvailable(
  metadata: ParsedSnapshotMetadata | undefined,
  callSitesAvailable: boolean,
  callResolutions: SnapshotCallResolutionRow[] | undefined,
): boolean {
  if (!callSitesAvailable || callResolutions === undefined) return false;
  if (metadata?.snapshotVersion !== KNOWLEDGE_SNAPSHOT_FORMAT_VERSION) {
    return false;
  }
  if (!isRecord(metadata.capabilities)) return false;
  const capability = metadata.capabilities.callResolutions;
  return (
    isRecord(capability) &&
    capability.version === SNAPSHOT_CALL_RESOLUTIONS_VERSION
  );
}

/**
 * Git-to-SQLite hydration (STOR-002), built entirely on `IGitProvider`'s raw primitives — the
 * reverse direction of `KnowledgeGitService`'s SQLite-to-Git snapshot write path.
 */
export class HydrationService implements IHydrationService {
  constructor(
    private readonly git: IGitProvider,
    private readonly logger: ILogger = createNoopLogger(),
  ) {}

  /**
   * "Given current source HEAD, which knowledge commit describes it (or its nearest analyzed
   * ancestor)?" (STOR-002's Source-Commit Lookup). One pass over the knowledge branch's own log
   * builds `sourceSha -> knowledgeSha` from `Docuvia-Source` trailers (newest entry per source sha
   * wins — covers rollback re-analysis); one pass over source HEAD's ancestry finds the first
   * match. Falls back to the branch tip when nothing is stamped (e.g. all-legacy history) or
   * nothing in `HEAD`'s ancestry was ever analyzed.
   */
  public async resolveHydrationCommit(
    cwd: string,
    branchName: string = GitConstants.KNOWLEDGE_ROOT,
  ): Promise<string | undefined> {
    const tip = await this.git.getBranchTipSha(cwd, branchName);
    if (!tip) return undefined;

    const log = await this.git.getCommitLog(
      cwd,
      branchName,
      GitConstants.KNOWLEDGE_LOG_SCAN_LIMIT,
    );
    const sourceToKnowledge = new Map<string, string>();
    for (const entry of log) {
      const sourceSha = parseSourceTrailer(entry.message);
      if (sourceSha && !sourceToKnowledge.has(sourceSha)) {
        sourceToKnowledge.set(sourceSha, entry.sha);
      }
    }
    if (sourceToKnowledge.size === 0) return tip;

    const ancestry = await this.git.getCommitAncestry(
      cwd,
      GitConstants.HEAD_REF,
      SOURCE_ANCESTRY_WALK_LIMIT,
    );
    for (const sourceSha of ancestry) {
      const match = sourceToKnowledge.get(sourceSha);
      if (match) return match;
    }
    return tip;
  }

  /**
   * Resolves the hydration commit, reads graph payloads off it, and bulk-loads them into `store`
   * via `bulkLoadGraph` (rebuild-not-upsert, per STOR-002). Records the hydrated commit sha in
   * `store.meta` so callers can cheaply detect staleness later. A no-op when there's nothing to
   * hydrate from yet (knowledge branch doesn't exist).
   */
  public async hydrate(
    cwd: string,
    store: IGraphStore,
    branchName: string = GitConstants.KNOWLEDGE_ROOT,
    options?: { force?: boolean },
  ): Promise<HydrationResult> {
    const knowledgeSha = await this.resolveHydrationCommit(cwd, branchName);
    if (!knowledgeSha) {
      this.logger.debug(GitMessages.NOTHING_TO_HYDRATE, {
        branchName,
      });
      return {
        hydrated: false,
        nodesLoaded: 0,
        edgesLoaded: 0,
        edgesDropped: 0,
      };
    }

    const [
      nodesJsonl,
      edgesJsonl,
      metadataJson,
      callSitesJsonl,
      callResolutionsJsonl,
    ] = await Promise.all([
      this.git.readFileAtRef(
        cwd,
        knowledgeSha,
        path.posix.join(
          GitConstants.GRAPH_DIR_NAME,
          GitConstants.NODES_JSONL_NAME,
        ),
      ),
      this.git.readFileAtRef(
        cwd,
        knowledgeSha,
        path.posix.join(
          GitConstants.GRAPH_DIR_NAME,
          GitConstants.EDGES_JSONL_NAME,
        ),
      ),
      this.git.readFileAtRef(
        cwd,
        knowledgeSha,
        path.posix.join(
          GitConstants.GRAPH_DIR_NAME,
          GitConstants.METADATA_JSON_NAME,
        ),
      ),
      this.git.readFileAtRef(
        cwd,
        knowledgeSha,
        path.posix.join(
          GitConstants.GRAPH_DIR_NAME,
          SNAPSHOT_CALL_SITES_JSONL_FILE_NAME,
        ),
      ),
      this.git.readFileAtRef(
        cwd,
        knowledgeSha,
        path.posix.join(
          GitConstants.GRAPH_DIR_NAME,
          SNAPSHOT_CALL_RESOLUTIONS_JSONL_FILE_NAME,
        ),
      ),
    ]);

    const nodes = parseNodesJsonl(nodesJsonl);
    const edges = parseEdgesJsonl(edgesJsonl);
    const metadata = parseSnapshotMetadata(metadataJson);
    const callSites = parseCallSitesJsonl(callSitesJsonl);
    const callResolutions = parseCallResolutionsJsonl(callResolutionsJsonl);

    const force = options?.force ?? false;
    if (!force) {
      const refusal = this.checkDestructiveRebuildGuard(store, nodes.length);
      if (refusal) {
        this.logger.warn(refusal.message, {
          knowledgeSha,
          incomingNodes: nodes.length,
        });
        return {
          hydrated: false,
          refused: true,
          refusalReason: refusal.reason,
          nodesLoaded: 0,
          edgesLoaded: 0,
          edgesDropped: 0,
        };
      }
    }

    const bulkResult = await store.withWriteLock(async () => {
      const projectId = this.restoreSnapshotMetadata(store, metadata);
      store.callSiteResolutions?.invalidateAll(projectId);
      this.restoreSnapshotCallSites(store, projectId, metadata, callSites);

      const loaded = store.graph.bulkLoadGraph({
        projectId,
        nodes,
        edges,
      });
      this.restoreSnapshotCallResolutions(
        store,
        projectId,
        metadata,
        callSites,
        callResolutions,
      );
      // L3DIST-007: the other half of the union (git -> local.db), absorbing any card this
      // developer never authored locally (a teammate's decision, or their own on a fresh clone).
      await importL3CardsFromKnowledgeBranch(
        this.git,
        cwd,
        knowledgeSha,
        store,
        this.logger,
      );
      store.meta.set(GitConstants.META_KEY_KNOWLEDGE_TIP_SHA, knowledgeSha);
      return loaded;
    });

    this.logger.info(GitMessages.HYDRATED_KNOWLEDGE_GRAPH, {
      knowledgeSha,
      ...bulkResult,
    });
    return { hydrated: true, knowledgeSha, ...bulkResult };
  }

  private restoreSnapshotMetadata(
    store: IGraphStore,
    metadata: ParsedSnapshotMetadata | undefined,
  ): number {
    const projectId = this.resolveHydratedProjectId(store, metadata?.project);
    for (const file of metadata?.files ?? []) {
      this.restoreFileMetadata(store, projectId, file);
    }
    if (metadata?.lastIngestedSourceSha) {
      store.meta.set(
        GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
        metadata.lastIngestedSourceSha,
      );
    }
    store.meta.set(
      `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
      snapshotCallerPolicy(metadata),
    );
    this.restoreDynamicEvidence(store, projectId, metadata);
    return projectId;
  }

  private restoreDynamicEvidence(
    store: IGraphStore,
    projectId: number,
    metadata: ParsedSnapshotMetadata | undefined,
  ): void {
    const key = `${DYNAMIC_DEPENDENCY_EVIDENCE_META_KEY_PREFIX}${projectId}`;
    const evidencePayload = getSnapshotDynamicEvidence(metadata);

    if (evidencePayload === undefined) {
      this.clearDynamicEvidence(store, key, metadata);
      return;
    }

    if (!isVersionedDynamicEvidence(evidencePayload)) {
      store.meta.set(key, JSON.stringify(evidencePayload) ?? "null");
      readDynamicDependencyEvidenceState(store, projectId);
      return;
    }

    store.meta.set(key, evidencePayload.payload);
    // The strict #508 decoder is the authority for malformed, wrong-shaped, and unavailable rows.
    readDynamicDependencyEvidenceState(store, projectId);
  }

  private clearDynamicEvidence(
    store: IGraphStore,
    key: string,
    metadata: ParsedSnapshotMetadata | undefined,
  ): void {
    if (store.meta.delete) {
      store.meta.delete(key);
      return;
    }
    store.meta.set(
      key,
      JSON.stringify({ snapshotVersion: metadata?.snapshotVersion ?? null }),
    );
  }

  private restoreSnapshotCallSites(
    store: IGraphStore,
    projectId: number,
    metadata: ParsedSnapshotMetadata | undefined,
    callSites: SnapshotCallSiteRow[] | undefined,
  ): void {
    const payloadAvailable = isSnapshotCallSitesPayloadAvailable(
      metadata,
      callSites,
    );
    const replaceForProject = store.callSites.replaceForProject;
    const canReplace = typeof replaceForProject === "function";

    if (canReplace) {
      replaceForProject.call(
        store.callSites,
        projectId,
        payloadAvailable ? (callSites ?? []) : [],
      );
    }

    store.meta.set(
      `${SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX}${projectId}`,
      payloadAvailable && canReplace
        ? SnapshotCallSiteAvailabilityStates.AVAILABLE
        : SnapshotCallSiteAvailabilityStates.UNAVAILABLE,
    );
  }

  private restoreSnapshotCallResolutions(
    store: IGraphStore,
    projectId: number,
    metadata: ParsedSnapshotMetadata | undefined,
    callSites: SnapshotCallSiteRow[] | undefined,
    callResolutions: SnapshotCallResolutionRow[] | undefined,
  ): void {
    const callSitesAvailable = isSnapshotCallSitesPayloadAvailable(
      metadata,
      callSites,
    );
    const payloadAvailable = isSnapshotCallResolutionsPayloadAvailable(
      metadata,
      callSitesAvailable,
      callResolutions,
    );
    const replaceForProject = store.callSiteResolutions?.replaceForProject;
    const canReplace = typeof replaceForProject === "function";
    if (canReplace) {
      replaceForProject.call(
        store.callSiteResolutions,
        projectId,
        payloadAvailable ? (callResolutions ?? []) : [],
      );
    }
    store.meta.set(
      `${SNAPSHOT_CALL_RESOLUTIONS_AVAILABILITY_META_KEY_PREFIX}${projectId}`,
      payloadAvailable && canReplace
        ? SnapshotCallResolutionAvailabilityStates.AVAILABLE
        : SnapshotCallResolutionAvailabilityStates.UNAVAILABLE,
    );
  }

  private resolveHydratedProjectId(
    store: IGraphStore,
    project: SnapshotMetadata["project"],
  ): number {
    if (project) {
      return store.projects.getOrInsert({
        name: project.name,
        repoUrl: project.repoUrl,
      }).id;
    }
    return (
      store.projects.getFirst()?.id ?? GitConstants.DEFAULT_LOCAL_PROJECT_ID
    );
  }

  private restoreFileMetadata(
    store: IGraphStore,
    projectId: number,
    file: SnapshotMetadata["files"][number],
  ): void {
    store.files.upsertFile({
      projectId,
      filePath: file.filePath,
      contentHash: file.contentHash,
    });
    if (file.lastTierBProcessedAt === null) return;
    store.files.markTierBProcessed({
      projectId,
      filePath: file.filePath,
      commitSha: file.lastTierBCommitSha,
      processedAt: file.lastTierBProcessedAt,
    });
  }

  /**
   * Same-workspace destructive-rebuild guard (2026-08 vscode-scale data-loss finding): `hydrate()`
   * is a rebuild-not-upsert per STOR-002, which is safe for cross-clone staleness (a different
   * clone's local.db legitimately catching up to a git branch someone else advanced) but unsafe
   * when *this* local.db's own most recent knowledge-branch write attempt hasn't been confirmed,
   * or when the incoming graph is a catastrophic reduction from what's already here -- either can
   * mean the resolved git commit is stale/corrupt/incomplete relative to strictly-newer local
   * data, not genuinely newer. Returns `undefined` (safe to proceed) unless a guard trips.
   */
  private checkDestructiveRebuildGuard(
    store: IGraphStore,
    incomingNodeCount: number,
  ):
    | { reason: "pending-local-write" | "catastrophic-shrink"; message: string }
    | undefined {
    if (store.meta.get(GitConstants.META_KEY_KNOWLEDGE_PACK_PENDING)) {
      return {
        reason: "pending-local-write",
        message: GitMessages.HYDRATE_REFUSED_PENDING_WRITE,
      };
    }
    const currentNodes = store.graph.count().l2Nodes;
    if (
      currentNodes >= MIN_NODES_FOR_SHRINK_GUARD &&
      incomingNodeCount < currentNodes * SHRINK_GUARD_MAX_RATIO
    ) {
      return {
        reason: "catastrophic-shrink",
        message: GitMessages.hydrateRefusedCatastrophicShrink(
          currentNodes,
          incomingNodeCount,
        ),
      };
    }
    return undefined;
  }

  public async isStale(
    cwd: string,
    store: IGraphStore,
    branchName: string = GitConstants.KNOWLEDGE_ROOT,
  ): Promise<boolean> {
    const resolved = await this.resolveHydrationCommit(cwd, branchName);
    if (!resolved) return false;
    const hydratedFrom = store.meta.get(
      GitConstants.META_KEY_KNOWLEDGE_TIP_SHA,
    );
    return hydratedFrom !== resolved;
  }

  public async markSynced(
    cwd: string,
    store: IGraphStore,
    branchName: string = GitConstants.KNOWLEDGE_ROOT,
  ): Promise<void> {
    const resolved = await this.resolveHydrationCommit(cwd, branchName);
    if (!resolved) return;
    await store.withWriteLock(() => {
      store.meta.set(GitConstants.META_KEY_KNOWLEDGE_TIP_SHA, resolved);
    });
  }

  /** Delegates to the shared `importL3CardsFromKnowledgeBranch` — the store write-lock is
   *  acquired internally; the knowledge-branch lock is the caller's responsibility. */
  public async importL3Cards(
    cwd: string,
    knowledgeSha: string,
    store: IGraphStore,
  ): Promise<{ cardsFound: number; imported: number }> {
    return store.withWriteLock(() =>
      importL3CardsFromKnowledgeBranch(
        this.git,
        cwd,
        knowledgeSha,
        store,
        this.logger,
      ),
    );
  }
}

function snapshotCallerPolicy(
  metadata: ParsedSnapshotMetadata | undefined,
): string {
  if (!isRecord(metadata?.capabilities)) {
    return CallsProjectionCallerPolicies.SCOPE_RESOLVER_V1;
  }
  const capability = metadata.capabilities.callsProjectionCallerPolicy;
  if (
    !isRecord(capability) ||
    capability.version !== SNAPSHOT_CALLS_PROJECTION_CALLER_POLICY_VERSION ||
    !isCallsProjectionCallerPolicy(capability.policy)
  ) {
    return CallsProjectionCallerPolicies.SCOPE_RESOLVER_V1;
  }
  return capability.policy;
}
