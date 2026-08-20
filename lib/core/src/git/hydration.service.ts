import path from "node:path";
import type {
  HydrationResult,
  IGitProvider,
  IGraphStore,
  IHydrationService,
  ILogger,
} from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import { GitConstants, GitMessages } from "./git-constants.js";
import { parseSourceTrailer } from "@workspace/contracts";
import { importL3CardsFromKnowledgeBranch } from "./l3-import.service.js";

/** Knowledge branch is a dedicated orphan branch of small, purpose-built commits — this comfortably bounds it without truncating any real history. */
const KNOWLEDGE_LOG_SCAN_LIMIT = 5000;
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
      KNOWLEDGE_LOG_SCAN_LIMIT,
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
   * Resolves the hydration commit, reads `graph/{nodes,edges}.jsonl` off it, and bulk-loads them
   * into `store` via `bulkLoadGraph` (rebuild-not-upsert, per STOR-002). Records the hydrated
   * commit sha in `store.meta` so callers can cheaply detect staleness later. A no-op when there's
   * nothing to hydrate from yet (knowledge branch doesn't exist).
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

    const [nodesJsonl, edgesJsonl] = await Promise.all([
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
    ]);

    const nodes = parseNodesJsonl(nodesJsonl);
    const edges = parseEdgesJsonl(edgesJsonl);

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
      const loaded = store.graph.bulkLoadGraph({
        projectId: GitConstants.DEFAULT_LOCAL_PROJECT_ID,
        nodes,
        edges,
      });
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
}
