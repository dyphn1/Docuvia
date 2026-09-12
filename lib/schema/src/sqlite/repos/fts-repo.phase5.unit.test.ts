import type Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { FtsRepo } from "./fts-repo.js";

// TDD-SOURCE: lib/contracts/src/interfaces/graph-store.interfaces.ts#IFtsRepo

function throwingDb(cause: Error): Database.Database {
  return {
    prepare: vi.fn(() => {
      throw cause;
    }),
  } as unknown as Database.Database;
}

describe("Phase 5 FtsRepo error contracts", () => {
  it("wraps L2 driver failures as DB_QUERY_FAILED and preserves the cause", () => {
    const cause = new Error("simulated sqlite l2 failure");
    const repo = new FtsRepo(throwingDb(cause));

    try {
      repo.searchL2Nodes(["auth"], 10);
      throw new Error("expected searchL2Nodes() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DocuviaError);
      expect(error).toMatchObject({
        code: ErrorCodes.DB_QUERY_FAILED,
        cause,
      });
      expect((error as Error).message).toContain(
        "Failed to search l2 nodes via FTS: simulated sqlite l2 failure",
      );
    }
  });

  it("wraps L3 driver failures as DB_QUERY_FAILED and preserves the cause", () => {
    const cause = new Error("simulated sqlite l3 failure");
    const repo = new FtsRepo(throwingDb(cause));

    try {
      repo.searchL3Nodes(["decision"], 10);
      throw new Error("expected searchL3Nodes() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DocuviaError);
      expect(error).toMatchObject({
        code: ErrorCodes.DB_QUERY_FAILED,
        cause,
      });
      expect((error as Error).message).toContain(
        "Failed to search l3 nodes via FTS: simulated sqlite l3 failure",
      );
    }
  });
});
