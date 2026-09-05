import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  acquireProcessLock,
  type ProcessLockHandle,
} from "@workspace/contracts";
import { withSyncStateLock } from "./sync-state.js";

vi.mock("@workspace/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/contracts")>();
  return { ...actual, acquireProcessLock: vi.fn() };
});

describe("withSyncStateLock lock-timeout mapping (issue #268)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-sync-lock-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("maps an acquire timeout to DB_LOCKED with the sync-state message", async () => {
    vi.mocked(acquireProcessLock).mockRejectedValueOnce(
      new Error("Timed out waiting for the lock at /x.lock"),
    );
    await expect(
      withSyncStateLock(tmpDir, async () => {}),
    ).rejects.toMatchObject({
      code: "DB_LOCKED",
      message: expect.stringContaining(
        "Timed out waiting for the sync-state lock",
      ),
    });
  });

  it("releases the delegated handle even when the callback throws", async () => {
    const release = vi.fn();
    vi.mocked(acquireProcessLock).mockResolvedValueOnce({
      release,
    } as unknown as ProcessLockHandle);
    await expect(
      withSyncStateLock(tmpDir, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
