import path from "node:path";
import type { IGitProvider, IGraphStore, ILogger } from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import { GitConstants, GitMessages } from "./git-constants.js";
import { computeL2GitPathsByNodeKey, parseL3Card } from "./l3-card-renderer.js";

interface RenderedNodeJson {
  id: string;
  name: string;
  filePath?: string;
}

interface RenderedEdgeJson {
  source: string;
  target: string;
  type: string;
}

/** Mirrors `HydrationService`'s identically-shaped, identically-named private parsers (kept as a
 *  small, self-contained duplicate here rather than an exported cross-file dependency, since the
 *  two call sites read the same `graph/*.jsonl` shape for different purposes — L2 bulk-load vs.
 *  this module's `l2_path` -> `nodeKey` resolution — and shouldn't be coupled by a shared private
 *  helper neither owns). */
function parseNodesJsonl(
  raw: string | undefined,
): Array<{ nodeKey: string; name: string; filePath?: string }> {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const node = JSON.parse(line) as RenderedNodeJson;
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
    .map((line) => JSON.parse(line) as RenderedEdgeJson);
}

export interface L3ImportResult {
  /** L3 cards found under `knowledge/_l3/` at `knowledgeSha`. */
  cardsFound: number;
  /** Of `cardsFound`, how many were newly inserted into local `l3_nodes` (the rest already
   *  existed locally by `content_hash`, or couldn't be resolved to a local L2 node yet). */
  imported: number;
}

/**
 * L3DIST-007: reads `knowledge/_l3/` off `knowledgeSha` and upserts newly-discovered cards into
 * local `l3_nodes` — the git -> local.db half of the union (a developer's own decisions are
 * already durable in `local.db`; this recovers a *teammate's* decisions, or this developer's own
 * decisions on a fresh clone that never ran `analyze` locally). Shared verbatim by
 * `HydrationService.hydrate()` and `sync-knowledge` (phase2-l3-distribution.md §3 wiring) so the
 * two never duplicate this logic.
 *
 * No lock is taken here (L3DIST-008): `knowledgeSha` is an already-resolved, immutable commit, so
 * every git read below is race-free by construction. Only `store.l3.importCard`'s local.db write
 * needs the store's own write-lock semantics — held by the caller (mirrors
 * `HydrationService.hydrate()`'s existing `store.withWriteLock` scope around `bulkLoadGraph`).
 */
export async function importL3CardsFromKnowledgeBranch(
  git: IGitProvider,
  cwd: string,
  knowledgeSha: string,
  store: IGraphStore,
  logger: ILogger = createNoopLogger(),
): Promise<L3ImportResult> {
  const l3DirPath = path.posix.join(
    GitConstants.KNOWLEDGE_DIR_NAME,
    GitConstants.L3_DIR_NAME,
  );
  const cardPaths = await git.listFilesAtRef(cwd, knowledgeSha, l3DirPath);
  if (cardPaths.length === 0) {
    return { cardsFound: 0, imported: 0 };
  }

  const [nodesJsonl, edgesJsonl] = await Promise.all([
    git.readFileAtRef(
      cwd,
      knowledgeSha,
      path.posix.join(
        GitConstants.GRAPH_DIR_NAME,
        GitConstants.NODES_JSONL_NAME,
      ),
    ),
    git.readFileAtRef(
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

  const nodeKeyByL2Path = new Map<string, string>();
  for (const [nodeKey, l2Path] of computeL2GitPathsByNodeKey(nodes, edges)) {
    nodeKeyByL2Path.set(l2Path, nodeKey);
  }

  let imported = 0;
  for (const cardPath of cardPaths) {
    const raw = await git.readFileAtRef(cwd, knowledgeSha, cardPath);
    if (!raw) continue;

    const card = parseL3Card(raw);
    if (!card) continue;

    const nodeKey = nodeKeyByL2Path.get(card.l2_path);
    if (!nodeKey) continue; // The L2 node this card refers to doesn't exist locally yet -- skip.
    const l2NodeId = store.graph.findNodeIdByNodeKey(nodeKey);
    if (l2NodeId === undefined) continue;

    const result = store.l3.importCard({
      l2NodeId,
      contentHash: card.content_hash,
      title: card.title,
      content: card.content,
      nodeType: card.node_type,
      sourceCommits: card.source_commits,
      extractionModel: card.extraction_model,
      sourceFiles: card.source_files,
      createdAt: card.created_at,
    });
    if (result.imported) imported++;
  }

  logger.info(GitMessages.IMPORTED_L3_CARDS, {
    cardsFound: cardPaths.length,
    imported,
  });
  return { cardsFound: cardPaths.length, imported };
}
