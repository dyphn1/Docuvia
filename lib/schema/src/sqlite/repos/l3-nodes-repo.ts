import type Database from "better-sqlite3";
import {
  DocuviaError,
  ErrorCodes,
  type IL3NodesRepo,
  type L3NodeRow,
  ValidityStatuses,
} from "@workspace/contracts";
import { SchemaTables } from "../constants.js";

const L3_NODES_ERROR_MESSAGES = {
  GET_BY_ID_FAILED: (id: number) => `Failed to get l3 node by id ${id}`,
  GET_ALL_EXPORTABLE_FAILED: "Failed to get all exportable l3 nodes",
} as const;

/**
 * `l3` repo — read-only surface over `l3_nodes` (AI-generated decisions). Deliberately no
 * write/population methods here: the LLM-extraction pipeline that populates `l3_nodes` is
 * out of scope for this batch (see `graph-store.integration.test.ts`'s `insertL3NodeFixture`
 * test-only helper, used until that pipeline exists).
 */
export class L3NodesRepo implements IL3NodesRepo {
  constructor(private readonly db: Database.Database) {}

  getById(id: number): L3NodeRow | undefined {
    try {
      return this.db
        .prepare(`SELECT * FROM ${SchemaTables.L3_NODES} WHERE id = ?`)
        .get(id) as L3NodeRow | undefined;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        L3_NODES_ERROR_MESSAGES.GET_BY_ID_FAILED(id),
        err,
      );
    }
  }

  /** Excludes stale/superseded decisions (`validity_status = 'garbage'`) — used by `export-topology`. */
  getAllExportable(): L3NodeRow[] {
    try {
      return this.db
        .prepare(
          `SELECT * FROM ${SchemaTables.L3_NODES} WHERE validity_status != '${ValidityStatuses.GARBAGE}'`,
        )
        .all() as L3NodeRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        L3_NODES_ERROR_MESSAGES.GET_ALL_EXPORTABLE_FAILED,
        err,
      );
    }
  }
}
