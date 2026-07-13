import type {
  HydrationResult,
  IGitProvider,
  IGraphStore,
  IHydrationService,
  ILogger,
} from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import { GitConstants } from "./git-constants.js";
import { parseSourceTrailer } from "./git-trailers.js";

/** Knowledge branch is a dedicated orphan branch of small, purpose-built commits — this comfortably bounds it without truncating any real history. */
const KNOWLEDGE_LOG_SCAN_LIMIT = 5000;
/** Bounds the source-HEAD ancestry walk during nearest-ancestor resolution. */
const SOURCE_ANCESTRY_WALK_LIMIT = 2000;

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
      "HEAD",
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
  ): Promise<HydrationResult> {
    const knowledgeSha = await this.resolveHydrationCommit(cwd, branchName);
    if (!knowledgeSha) {
      this.logger.debug(
        "Nothing to hydrate from yet — knowledge branch doesn't exist",
        {
          branchName,
        },
      );
      return {
        hydrated: false,
        nodesLoaded: 0,
        edgesLoaded: 0,
        edgesDropped: 0,
      };
    }

    const [nodesJsonl, edgesJsonl] = await Promise.all([
      this.git.readFileAtRef(cwd, knowledgeSha, "graph/nodes.jsonl"),
      this.git.readFileAtRef(cwd, knowledgeSha, "graph/edges.jsonl"),
    ]);

    const nodes = parseNodesJsonl(nodesJsonl);
    const edges = parseEdgesJsonl(edgesJsonl);

    const bulkResult = await store.withWriteLock(() => {
      const loaded = store.graph.bulkLoadGraph({
        projectId: GitConstants.DEFAULT_LOCAL_PROJECT_ID,
        nodes,
        edges,
      });
      store.meta.set(GitConstants.META_KEY_KNOWLEDGE_TIP_SHA, knowledgeSha);
      return loaded;
    });

    this.logger.info("Hydrated knowledge graph from git", {
      knowledgeSha,
      ...bulkResult,
    });
    return { hydrated: true, knowledgeSha, ...bulkResult };
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
