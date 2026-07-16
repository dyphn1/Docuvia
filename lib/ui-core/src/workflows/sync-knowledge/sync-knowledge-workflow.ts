import {
  docuviaFactory,
  TOKENS,
  type ILogger,
  type KnowledgeBranchSyncResult,
} from "@workspace/contracts";
import {
  SYNC_KNOWLEDGE_EVENTS,
  SYNC_KNOWLEDGE_MESSAGES,
} from "./sync-knowledge-messages.js";
import { appendSyncKnowledgeLogLine } from "./sync-knowledge-log-writer.js";

/**
 * The `sync-knowledge` workflow — the explicit, user-triggerable entry point for cross-clone
 * reconciliation (STOR-001 point 3): fetches `origin`'s copy of the knowledge branch and
 * reconciles it with the local one via `IKnowledgeGitService.syncKnowledgeBranch()`. Purely a git
 * operation — never opens `local.db` (unlike `snapshot`/`hydrate`).
 *
 * Deliberately not auto-wired into the post-commit hook or into every `snapshot`/`hydrate` call:
 * it's a network operation (fetch + possibly push), and firing it implicitly on every local
 * commit would surprise users and slow down what the hook promises is a "non-intrusive" background
 * step. It IS safe to run repeatedly and non-fatal when offline (see `KnowledgeGitService`'s
 * `no-remote` result), so wiring it into a scheduled task or CI step is a reasonable follow-up.
 */
export class SyncKnowledgeWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(): Promise<KnowledgeBranchSyncResult> {
    const { workspaceRoot, logger } = this;

    logger.info(SYNC_KNOWLEDGE_MESSAGES.SYNCING);
    await appendSyncKnowledgeLogLine(workspaceRoot, {
      event: SYNC_KNOWLEDGE_EVENTS.START,
      workspaceRoot,
    });

    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger,
    });
    const result = await knowledgeGit.syncKnowledgeBranch(workspaceRoot);

    await appendSyncKnowledgeLogLine(workspaceRoot, {
      event: SYNC_KNOWLEDGE_EVENTS.SUMMARY,
      status: result.status,
      branchTipSha: result.branchTipSha ?? null,
    });

    return result;
  }
}
