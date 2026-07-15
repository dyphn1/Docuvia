import {
  docuviaMemory,
  DocuviaError,
  ErrorCodes,
  type ILogger,
} from "@workspace/contracts";
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

function requireMemory<T>(scopeId: string, key: string): T {
  const value = docuviaMemory.get<T>(scopeId, key);
  if (value === undefined) {
    throw new DocuviaError(
      ErrorCodes.INVALID_INPUT,
      `docuviaApi: no "${key}" set in memory scope "${scopeId}"`,
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
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    return new InitWorkflow(workspaceRoot, logger).execute();
  },

  async clean(scopeId: string, logger: ILogger): Promise<CleanResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    return new CleanWorkflow(workspaceRoot, logger).execute();
  },

  async status(scopeId: string, logger: ILogger): Promise<StatusResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    return new StatusWorkflow(workspaceRoot, logger).execute();
  },

  async sync(scopeId: string, logger: ILogger): Promise<SyncResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    const apiUrl = requireMemory<string>(scopeId, "apiUrl");
    const pat = requireMemory<string>(scopeId, "pat");
    const projectId = requireMemory<string>(scopeId, "projectId");
    const commitSha = docuviaMemory.get<string>(scopeId, "commitSha");
    return new SyncWorkflow(workspaceRoot, logger, apiUrl, pat).execute({
      projectId,
      commitSha,
    });
  },

  async analyze(scopeId: string, logger: ILogger): Promise<AnalyzeResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    const targetPath = docuviaMemory.get<string>(scopeId, "targetPath");
    if (!targetPath) {
      return new AnalyzeWorkflow(workspaceRoot, logger).execute();
    }
    const llmBaseUrl = requireMemory<string>(scopeId, "llmBaseUrl");
    const llmModel = requireMemory<string>(scopeId, "llmModel");
    const llmApiKey = docuviaMemory.get<string>(scopeId, "llmApiKey");
    return new AnalyzeWorkflow(workspaceRoot, logger, {
      targetPath,
      llmBaseUrl,
      llmApiKey,
      llmModel,
    }).execute();
  },

  async review(scopeId: string, logger: ILogger): Promise<ReviewResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    const baseRef = docuviaMemory.get<string>(scopeId, "baseRef");
    return new ReviewWorkflow(workspaceRoot, logger).execute(baseRef);
  },

  async impact(scopeId: string, logger: ILogger): Promise<ImpactResult | null> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    const target = requireMemory<string>(scopeId, "target");
    const escalateToLsp = docuviaMemory.get<boolean>(scopeId, "escalateToLsp");
    return new ImpactWorkflow(workspaceRoot, logger).execute(target, {
      escalateToLsp,
    });
  },

  async query(scopeId: string, logger: ILogger): Promise<QueryResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    const target = requireMemory<string>(scopeId, "target");
    const limit = docuviaMemory.get<number>(scopeId, "limit");
    return new QueryWorkflow(workspaceRoot, logger).execute(target, limit);
  },

  async exportTopology(
    scopeId: string,
    logger: ILogger,
  ): Promise<TopologyGraph> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    const collapse = docuviaMemory.get<TopologyExportOptions["collapse"]>(
      scopeId,
      "collapse",
    );
    return new ExportTopologyWorkflow(workspaceRoot, logger).execute({
      collapse,
    });
  },

  async snapshot(scopeId: string, logger: ILogger): Promise<SnapshotResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    return new SnapshotWorkflow(workspaceRoot, logger).execute();
  },

  async hydrate(scopeId: string, logger: ILogger): Promise<HydrateResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    return new HydrateWorkflow(workspaceRoot, logger).execute();
  },

  async syncKnowledge(
    scopeId: string,
    logger: ILogger,
  ): Promise<KnowledgeBranchSyncResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    return new SyncKnowledgeWorkflow(workspaceRoot, logger).execute();
  },

  async doctor(
    scopeId: string,
    logger: ILogger,
    options?: DoctorOptions,
  ): Promise<DoctorResult> {
    const workspaceRoot = requireMemory<string>(scopeId, "workspaceRoot");
    return new DoctorWorkflow(workspaceRoot, logger).execute(options);
  },
};
