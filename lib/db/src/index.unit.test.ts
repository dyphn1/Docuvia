import { describe, it, expect } from "vitest";
import { runInRollbackTransaction } from "./index";

describe("db index", () => {
  it("throws expected errors during rollback", async () => {
    await expect(
      runInRollbackTransaction(async () => {
        throw new Error("Anthem");
      })
    ).rejects.toThrow("Anthem");
  });
});
