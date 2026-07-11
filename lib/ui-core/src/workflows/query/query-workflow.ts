import { docuviaFactory, TOKENS, DocuviaError, ErrorCodes, type ILogger } from "@workspace/contracts";
import { QUERY_MESSAGES } from "./query-messages.js";
import { appendQueryLogLine } from "./query-log-writer.js";
import type { QueryResult } from "./query-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";

/**
 * The `query` workflow — local-first (no-LLM) natural-language + structural query, delegated
 * entirely to the Domain Core's `IQueryService` (mirrors old Docuvia's `QueryService.query`,
 * minus the LLM-based intent-extraction hop, which is out of scope for this milestone — see
 * `IQueryService.extractKeywords`'s doc comment).
 */
export class QueryWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger
  ) {}

  public async execute(target: string, limit?: number): Promise<QueryResult> {
    const { workspaceRoot, logger } = this;

    logger.info(QUERY_MESSAGES.QUERYING);
    await appendQueryLogLine(workspaceRoot, { event: "query.start", target });

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    let store;
    try {
      store = await openStore({ dbPath: resolveDbPath(workspaceRoot), readonly: true });
    } catch (err) {
      if (err instanceof DocuviaError && err.code === ErrorCodes.DB_OPEN_FAILED) {
        await appendQueryLogLine(workspaceRoot, {
          event: "query.error",
          target,
          message: QUERY_MESSAGES.DB_NOT_FOUND,
        });
        throw new DocuviaError(ErrorCodes.DB_OPEN_FAILED, QUERY_MESSAGES.DB_NOT_FOUND, err);
      }
      throw err;
    }

    try {
      const queryService = docuviaFactory.resolve(TOKENS.QueryService, { logger });
      const result = queryService.query(store, target, limit);

      const found = Boolean(result.l2) || result.l3.length > 0 || Boolean(result.context);
      await appendQueryLogLine(workspaceRoot, { event: "query.summary", target, found });

      return result;
    } finally {
      await store.close();
    }
  }
}
