import {
  docuviaFactory,
  TOKENS,
  type IKnowledgeGitService,
  type ILogger,
  type KnowledgeBranchSyncResult,
} from "@workspace/contracts";
import { importL3CardsFromKnowledgeBranch } from "@workspace/core";
import {
  SYNC_KNOWLEDGE_EVENTS,
  SYNC_KNOWLEDGE_MESSAGES,
} from "./sync-knowledge-messages.js";
import { appendSyncKnowledgeLogLine } from "./sync-knowledge-log-writer.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";

/**
 * The `sync-knowledge` workflow — the explicit, user-triggerable entry point for cross-clone
 * reconciliation (STOR-001 point 3): fetches `origin`'s copy of the knowledge branch and
 * reconciles it with the local one via `IKnowledgeGitService.syncKnowledgeBranch()`.
 *
 * Deliberately not auto-wired into the post-commit hook or into every `snapshot`/`hydrate` call:
 * it's a network operation (fetch + possibly push), and firing it implicitly on every local
 * commit would surprise users and slow down what the hook promises is a "non-intrusive" background
 * step. It IS safe to run repeatedly and non-fatal when offline (see `KnowledgeGitService`'s
 * `no-remote` result), so wiring it into a scheduled task or CI step is a reasonable follow-up.
 *
 * phase2-l3-distribution.md §3 wiring: once reconciliation resolves a branch tip, this also runs
 * the same L3-import routine `hydrate` uses (`importL3CardsFromKnowledgeBranch`, shared code, not
 * duplicated) so a developer who just fast-forwarded/merged the knowledge branch immediately
 * absorbs any teammate's cards that survived Tree-Adoption, without waiting for a separate
 * explicit `hydrate`. This is the one case where `sync-knowledge` does open `local.db` — guarded
 * behind `runUnderKnowledgeLock` so it can't race a concurrent `snapshot`'s read-then-pack of the
 * same file (L3DIST-008's reasoning, mirroring `analyze` auto mode's delta-persist precedent).
 */
export class SyncKnowledgeWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
    /** `DOCUVIA_PUSH_TIMEOUT_MS` override, read from `docuviaMemory` by `docuvia-api.ts`'s
     *  `syncKnowledge()` (Presentation layer already did the `process.env` translation) — passed
     *  through to `KnowledgeGitService` so `fetchRef`/`pushRef` wait for the transfer to finish by
     *  default instead of a hardcoded bound. */
    private readonly gitNetworkTimeoutMs?: number,
  ) {}

  public async execute(): Promise<KnowledgeBranchSyncResult> {
    const { workspaceRoot, logger, gitNetworkTimeoutMs } = this;

    logger.info(SYNC_KNOWLEDGE_MESSAGES.SYNCING);
    await appendSyncKnowledgeLogLine(workspaceRoot, {
      event: SYNC_KNOWLEDGE_EVENTS.START,
      workspaceRoot,
    });

    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger,
      gitNetworkTimeoutMs,
    });
    const result = await knowledgeGit.syncKnowledgeBranch(workspaceRoot);

    if (result.branchTipSha) {
      await this.importL3Cards(knowledgeGit, result.branchTipSha);
    }

    await appendSyncKnowledgeLogLine(workspaceRoot, {
      event: SYNC_KNOWLEDGE_EVENTS.SUMMARY,
      status: result.status,
      branchTipSha: result.branchTipSha ?? null,
    });

    return result;
  }

  private async importL3Cards(
    knowledgeGit: IKnowledgeGitService,
    knowledgeSha: string,
  ): Promise<void> {
    const { workspaceRoot, logger } = this;
    const gitProvider = docuviaFactory.resolve(TOKENS.GitProvider);
    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    const store = await openStore({
      dbPath: resolveDbPath(workspaceRoot),
      readonly: false,
    });
    try {
      await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, () =>
        store.withWriteLock(() =>
          importL3CardsFromKnowledgeBranch(
            gitProvider,
            workspaceRoot,
            knowledgeSha,
            store,
            logger,
          ),
        ),
      );
    } finally {
      await store.close();
    }
  }
}
