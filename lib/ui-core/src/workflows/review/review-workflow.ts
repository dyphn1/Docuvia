import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type ILogger,
} from "@workspace/contracts";
import { REVIEW_EVENTS, REVIEW_MESSAGES } from "./review-messages.js";
import { appendReviewLogLine } from "./review-log-writer.js";
import type { ReviewResult } from "./review-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { ensureHydrated } from "../../utils/ensure-hydrated.js";

/**
 * The `review` workflow (file-level change detection) — resolves the changed-file set via
 * `IGitProvider.getChangedFilesSince`, opens `.docuvia/local.db` readonly, then delegates
 * blast-radius resolution + risk aggregation to the Domain Core's `IChangeDetectionService`
 * (mirrors old Docuvia's `ChangeDetectionService.detectChanges`, split across the
 * orchestration/domain boundary per the Two-Layer Virtual Contracts architecture).
 */
export class ReviewWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(baseRef?: string): Promise<ReviewResult> {
    const { workspaceRoot, logger } = this;

    logger.info(REVIEW_MESSAGES.DETECTING_CHANGES);
    await appendReviewLogLine(workspaceRoot, {
      event: REVIEW_EVENTS.START,
      baseRef: baseRef ?? null,
    });

    const git = docuviaFactory.resolve(TOKENS.GitProvider);
    const rawChanges = await git.getChangedFilesSince(workspaceRoot, baseRef);
    const filesChanged = rawChanges.map((c) => ({
      file: c.file,
      status: c.status,
    }));

    await ensureHydrated(workspaceRoot, logger);

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    let store;
    try {
      store = await openStore({
        dbPath: resolveDbPath(workspaceRoot),
        readonly: true,
      });
    } catch (err) {
      if (
        err instanceof DocuviaError &&
        err.code === ErrorCodes.DB_NOT_FOUND
      ) {
        await appendReviewLogLine(workspaceRoot, {
          event: REVIEW_EVENTS.ERROR,
          message: REVIEW_MESSAGES.DB_NOT_FOUND,
        });
        throw new DocuviaError(
          ErrorCodes.DB_NOT_FOUND,
          REVIEW_MESSAGES.DB_NOT_FOUND,
          err,
        );
      }
      throw err;
    }

    try {
      const changeDetectionService = docuviaFactory.resolve(
        TOKENS.ChangeDetectionService,
        { logger },
      );
      const result = changeDetectionService.detectChanges({
        store,
        baseRef: baseRef ?? null,
        filesChanged,
      });

      await appendReviewLogLine(workspaceRoot, {
        event: REVIEW_EVENTS.SUMMARY,
        baseRef: baseRef ?? null,
        riskLevel: result.riskLevel,
        filesChanged: result.filesChanged.length,
        affectedNodes: result.affectedNodes.length,
      });

      return result;
    } finally {
      await store.close();
    }
  }
}
