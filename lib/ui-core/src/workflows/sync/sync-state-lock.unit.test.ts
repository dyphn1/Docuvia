import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ProcessLockTimeoutError,
  type AcquireProcessLock,
  type ProcessLockHandle,
} from "@workspace/contracts";
import { withSyncStateLock } from "./sync-state.js";

describe("withSyncStateLock lock acquisition (issue #268)", () => {
  let tmpDir: string;
  let acquireProcessLock: ReturnType<typeof vi.fn<AcquireProcessLock>>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-sync-lock-test-"));
    acquireProcessLock = vi.fn<AcquireProcessLock>();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("maps timeout to DB_LOCKED", async () => {
    acquireProcessLock.mockRejectedValueOnce(
      new ProcessLockTimeoutError("/x.lock"),
    );
    const run = withSyncStateLock(tmpDir, acquireProcessLock, async () => {});

    await expect(run).rejects.toMatchObject({
      code: "DB_LOCKED",
      message: expect.stringContaining(
        "Timed out waiting for the sync-state lock",
      ),
    });
  });

  it("preserves non-timeout acquisition failures", async () => {
    const ioError = Object.assign(new Error("read-only filesystem"), {
      code: "EROFS",
    });
    acquireProcessLock.mockRejectedValueOnce(ioError);
    const run = withSyncStateLock(tmpDir, acquireProcessLock, async () => {});

    await expect(run).rejects.toBe(ioError);
  });

  it("releases the delegated handle when the callback throws", async () => {
    const release = vi.fn();
    acquireProcessLock.mockResolvedValueOnce({
      release,
    } as unknown as ProcessLockHandle);

    await expect(
      withSyncStateLock(tmpDir, acquireProcessLock, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(release).toHaveBeenCalledTimes(1);
  });
});
