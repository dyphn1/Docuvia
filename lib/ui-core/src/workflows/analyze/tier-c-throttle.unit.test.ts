import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  ProcessLockTimeoutError,
  type AcquireProcessLock,
} from "@workspace/contracts";
import {
  checkTierCSystemLoad,
  tryAcquireTierCLock,
} from "./tier-c-throttle.js";

function createTestProcessLock(): AcquireProcessLock {
  let held = false;
  return async (lockPath) => {
    if (held) throw new ProcessLockTimeoutError(lockPath);
    held = true;
    let released = false;
    return {
      async release(): Promise<void> {
        if (released) return;
        released = true;
        held = false;
      },
    };
  };
}

describe("tryAcquireTierCLock() (§9f, §9k gating test 3)", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    resetFactoryForTests();
    const acquireProcessLock = createTestProcessLock();
    docuviaFactory.register(TOKENS.ProcessLock, () => acquireProcessLock);
  });

  afterEach(() => {
    if (workspaceRoot)
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("acquires the lock when uncontended", async () => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-lock-test-"),
    );
    const lock = await tryAcquireTierCLock(workspaceRoot);
    expect(lock).toBeDefined();
    await lock!.release();
  });

  it("a second concurrent dispatch attempt is rejected (returns undefined) while the first holds the lock", async () => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-lock-test-"),
    );
    const first = await tryAcquireTierCLock(workspaceRoot);
    expect(first).toBeDefined();

    const second = await tryAcquireTierCLock(workspaceRoot);
    expect(second).toBeUndefined();

    await first!.release();
  });

  it("a fresh attempt succeeds again once the first lock is released", async () => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierc-lock-test-"),
    );
    const first = await tryAcquireTierCLock(workspaceRoot);
    await first!.release();

    const second = await tryAcquireTierCLock(workspaceRoot);
    expect(second).toBeDefined();
    await second!.release();
  });
});

describe("checkTierCSystemLoad()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a documented no-op on Windows (ok: true, with an explanatory note)", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const result = checkTierCSystemLoad(0.8);
    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/no-op/i);
  });

  it("is ok when the load ratio is under the threshold (non-Windows)", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.spyOn(os, "loadavg").mockReturnValue([1, 1, 1]);
    vi.spyOn(os, "cpus").mockReturnValue(Array(4).fill({}) as os.CpuInfo[]);
    const result = checkTierCSystemLoad(0.8);
    expect(result.ok).toBe(true);
    expect(result.note).toBeUndefined();
  });

  it("trips when the load ratio exceeds the threshold (non-Windows)", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.spyOn(os, "loadavg").mockReturnValue([8, 8, 8]);
    vi.spyOn(os, "cpus").mockReturnValue(Array(4).fill({}) as os.CpuInfo[]);
    const result = checkTierCSystemLoad(0.8);
    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/exceeds threshold/);
  });
});
