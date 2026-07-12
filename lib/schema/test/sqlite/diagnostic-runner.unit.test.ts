import { describe, it, expect, vi, beforeEach } from "vitest";
import { SqliteDiagnosticRunner } from "../../src/sqlite/diagnostic-runner.js";
import { DiagnosticStatus } from "@workspace/contracts";
import * as fs from "node:fs/promises";
import DatabaseConstructor from "better-sqlite3";

vi.mock("node:fs/promises");
vi.mock("better-sqlite3");

describe("SqliteDiagnosticRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns FAIL for connection error", async () => {
    vi.mocked(DatabaseConstructor).mockImplementation(() => {
      throw new Error("Cannot open");
    });
    const runner = new SqliteDiagnosticRunner();
    const result = await runner.checkHealth("/test.db");

    expect(result["sqlite_connection"].status).toBe(DiagnosticStatus.FAIL);
    expect(result["sqlite_connection"].details).toContain("Cannot open");
  });

  it("returns PASS for good integrity and normal WAL", async () => {
    const mockDb = {
      pragma: vi.fn().mockReturnValue([{ integrity_check: "ok" }]),
      close: vi.fn(),
    };
    vi.mocked(DatabaseConstructor).mockImplementation(() => mockDb as any);
    vi.mocked(fs.stat).mockResolvedValue({ size: 1000 } as any);

    const runner = new SqliteDiagnosticRunner();
    const result = await runner.checkHealth("/test.db");

    expect(result["sqlite_integrity"].status).toBe(DiagnosticStatus.PASS);
    expect(result["sqlite_wal_bloat"].status).toBe(DiagnosticStatus.PASS);
    expect(mockDb.close).toHaveBeenCalled();
  });

  it("returns PASS for simple 'ok' integrity", async () => {
    const mockDb = {
      pragma: vi.fn().mockReturnValue("ok"),
      close: vi.fn(),
    };
    vi.mocked(DatabaseConstructor).mockImplementation(() => mockDb as any);

    const runner = new SqliteDiagnosticRunner();
    const result = await runner.checkHealth("/test.db");

    expect(result["sqlite_integrity"].status).toBe(DiagnosticStatus.PASS);
  });

  it("returns FAIL for bad integrity array", async () => {
    const mockDb = {
      pragma: vi.fn().mockReturnValue([{ integrity_check: "error" }]),
      close: vi.fn(),
    };
    vi.mocked(DatabaseConstructor).mockImplementation(() => mockDb as any);

    const runner = new SqliteDiagnosticRunner();
    const result = await runner.checkHealth("/test.db");

    expect(result["sqlite_integrity"].status).toBe(DiagnosticStatus.FAIL);
  });

  it("returns FAIL for pragma throwing error", async () => {
    const mockDb = {
      pragma: vi.fn().mockImplementation(() => {
        throw new Error("pragma error");
      }),
      close: vi.fn(),
    };
    vi.mocked(DatabaseConstructor).mockImplementation(() => mockDb as any);

    const runner = new SqliteDiagnosticRunner();
    const result = await runner.checkHealth("/test.db");

    expect(result["sqlite_integrity"].status).toBe(DiagnosticStatus.FAIL);
    expect(result["sqlite_integrity"].details).toContain("pragma error");
  });

  it("returns FAIL for bloated WAL", async () => {
    const mockDb = {
      pragma: vi.fn().mockReturnValue("ok"),
      close: vi.fn(),
    };
    vi.mocked(DatabaseConstructor).mockImplementation(() => mockDb as any);
    vi.mocked(fs.stat).mockResolvedValue({ size: 150 * 1024 * 1024 } as any); // 150MB

    const runner = new SqliteDiagnosticRunner();
    const result = await runner.checkHealth("/test.db");

    expect(result["sqlite_wal_bloat"].status).toBe(DiagnosticStatus.FAIL);
    expect(result["sqlite_wal_bloat"].message).toContain("too large");
  });
});
