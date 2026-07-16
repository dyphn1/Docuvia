import {
  docuviaMemory,
  DocuviaError,
  ErrorCodes,
  MemoryKeys,
  type ILogger,
  type MemoryKey,
} from "@workspace/contracts";
import { DOCUVIA_API_MESSAGES } from "./constants/docuvia-api-messages.js";
import { InitWorkflow } from "./workflows/init/init-workflow.js";
import type { InitResult } from "./workflows/init/init-result.js";
import { CleanWorkflow } from "./workflows/clean/clean-workflow.js";
import type { CleanResult } from "./workflows/clean/clean-result.js";
import { StatusWorkflow } from "./workflows/status/status-workflow.js";
import type { StatusResult } from "./workflows/status/status-result.js";
import { SyncWorkflow } from "./workflows/sync/sync-workflow.js";
import type { SyncResult } from "./workflows/sync/sync-result.js";
import { AnalyzeWorkflow } from "./workflows/analyze/analyze-workflow.js";
import type { AnalyzeResult } from "./workflows/analyze/analyze-result.js";
import { ReviewWorkflow } from "./workflows/review/review-workflow.js";
import type { ReviewResult } from "./workflows/review/review-result.js";
import { ImpactWorkflow } from "./workflows/impact/impact-workflow.js";
import type { ImpactResult } from "./workflows/impact/impact-result.js";
import { QueryWorkflow } from "./workflows/query/query-workflow.js";
import type { QueryResult } from "./workflows/query/query-result.js";
import { ExportTopologyWorkflow } from "./workflows/export-topology/export-topology-workflow.js";
import type {
  TopologyExportOptions,
  TopologyGraph,
} from "@workspace/contracts";
import { SnapshotWorkflow } from "./workflows/snapshot/snapshot-workflow.js";
import type { SnapshotResult } from "./workflows/snapshot/snapshot-result.js";
import { HydrateWorkflow } from "./workflows/hydrate/hydrate-workflow.js";
import type { HydrateResult } from "./workflows/hydrate/hydrate-result.js";
import { SyncKnowledgeWorkflow } from "./workflows/sync-knowledge/sync-knowledge-workflow.js";
import type { KnowledgeBranchSyncResult } from "@workspace/contracts";
import {
  DoctorWorkflow,
  type DoctorOptions,
} from "./workflows/doctor/doctor-workflow.js";
import type { DoctorResult } from "./workflows/doctor/doctor-result.js";

function requireMemory<T>(scopeId: string, key: MemoryKey): T {
  const value = docuviaMemory.get<T>(scopeId, key);
  if (value === undefined) {
    throw new DocuviaError(
      ErrorCodes.INVALID_INPUT,
      DOCUVIA_API_MESSAGES.MISSING_MEMORY_KEY(key, scopeId),
    );
  }
  return value;
}

/**
 * The unified `docuviaApi` — the only surface `artifacts/cli`/`mcp` call (see
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Orchestration Layer). Callers
 * must have already created a `docuviaMemory` scope for `scopeId` and set `workspaceRoot`
 * before calling; they own deleting that scope once the run completes (Garbage Collection).
 */
export const docuviaApi = {
  async init(scopeId: string, logger: ILogger): Promise<InitResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new InitWorkflow(workspaceRoot, logger).execute();
  },

  async clean(scopeId: string, logger: ILogger): Promise<CleanResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new CleanWorkflow(workspaceRoot, logger).execute();
  },

  async status(scopeId: string, logger: ILogger): Promise<StatusResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new StatusWorkflow(workspaceRoot, logger).execute();
  },

  async sync(scopeId: string, logger: ILogger): Promise<SyncResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const apiUrl = requireMemory<string>(scopeId, MemoryKeys.API_URL);
    const pat = requireMemory<string>(scopeId, MemoryKeys.PAT);
    const projectId = requireMemory<string>(scopeId, MemoryKeys.PROJECT_ID);
    const commitSha = docuviaMemory.get<string>(scopeId, MemoryKeys.COMMIT_SHA);
    return new SyncWorkflow(workspaceRoot, logger, apiUrl, pat).execute({
      projectId,
      commitSha,
    });
  },

  async analyze(scopeId: string, logger: ILogger): Promise<AnalyzeResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const targetPath = docuviaMemory.get<string>(
      scopeId,
      MemoryKeys.TARGET_PATH,
    );
    if (!targetPath) {
      return new AnalyzeWorkflow(workspaceRoot, logger).execute();
    }
    const llmBaseUrl = requireMemory<string>(scopeId, MemoryKeys.LLM_BASE_URL);
    const llmModel = requireMemory<string>(scopeId, MemoryKeys.LLM_MODEL);
    const llmApiKey = docuviaMemory.get<string>(
      scopeId,
      MemoryKeys.LLM_API_KEY,
    );
    return new AnalyzeWorkflow(workspaceRoot, logger, {
      targetPath,
      llmBaseUrl,
      llmApiKey,
      llmModel,
    }).execute();
  },

  async review(scopeId: string, logger: ILogger): Promise<ReviewResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const baseRef = docuviaMemory.get<string>(scopeId, MemoryKeys.BASE_REF);
    return new ReviewWorkflow(workspaceRoot, logger).execute(baseRef);
  },

  async impact(scopeId: string, logger: ILogger): Promise<ImpactResult | null> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const target = requireMemory<string>(scopeId, MemoryKeys.TARGET);
    const escalateToLsp = docuviaMemory.get<boolean>(
      scopeId,
      MemoryKeys.ESCALATE_TO_LSP,
    );
    return new ImpactWorkflow(workspaceRoot, logger).execute(target, {
      escalateToLsp,
    });
  },

  async query(scopeId: string, logger: ILogger): Promise<QueryResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const target = requireMemory<string>(scopeId, MemoryKeys.TARGET);
    const limit = docuviaMemory.get<number>(scopeId, MemoryKeys.LIMIT);
    return new QueryWorkflow(workspaceRoot, logger).execute(target, limit);
  },

  async exportTopology(
    scopeId: string,
    logger: ILogger,
  ): Promise<TopologyGraph> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const collapse = docuviaMemory.get<TopologyExportOptions["collapse"]>(
      scopeId,
      MemoryKeys.COLLAPSE,
    );
    return new ExportTopologyWorkflow(workspaceRoot, logger).execute({
      collapse,
    });
  },

  async snapshot(scopeId: string, logger: ILogger): Promise<SnapshotResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new SnapshotWorkflow(workspaceRoot, logger).execute();
  },

  async hydrate(scopeId: string, logger: ILogger): Promise<HydrateResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new HydrateWorkflow(workspaceRoot, logger).execute();
  },

  async syncKnowledge(
    scopeId: string,
    logger: ILogger,
  ): Promise<KnowledgeBranchSyncResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new SyncKnowledgeWorkflow(workspaceRoot, logger).execute();
  },

  async doctor(
    scopeId: string,
    logger: ILogger,
    options?: DoctorOptions,
  ): Promise<DoctorResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new DoctorWorkflow(workspaceRoot, logger).execute(options);
  },
};
