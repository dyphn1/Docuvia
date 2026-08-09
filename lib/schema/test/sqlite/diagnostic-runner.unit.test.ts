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
    // Without an ABI-marker, no dedicated abi_mismatch check is emitted.
    expect(result["sqlite_abi_mismatch"]).toBeUndefined();
  });

  it("emits a dedicated sqlite_abi_mismatch FAIL when the native module has a Node ABI drift", async () => {
    vi.mocked(DatabaseConstructor).mockImplementation(() => {
      throw new Error(
        "The module better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 141. This version of Node.js requires NODE_MODULE_VERSION 137.",
      );
    });
    const runner = new SqliteDiagnosticRunner();
    const result = await runner.checkHealth("/test.db");

    const abi = result["sqlite_abi_mismatch"];
    expect(abi.status).toBe(DiagnosticStatus.FAIL);
    expect(abi.message).toContain("NODE_MODULE_VERSION drift");
    expect(abi.suggestion).toContain("rebuild better-sqlite3");
    expect(abi.suggestion).toContain("SAME Node.js");
    // The connection check inherits the ABI suggestion, not the permissions one.
    expect(result["sqlite_connection"].suggestion).toContain(
      "rebuild better-sqlite3",
    );
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
