import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  acquireProcessLock,
  ProcessLockTimeoutError,
  type ProcessLockHandle,
} from "@workspace/contracts";
import { withSyncStateLock } from "./sync-state.js";

vi.mock("@workspace/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/contracts")>();
  return { ...actual, acquireProcessLock: vi.fn() };
});

describe("withSyncStateLock lock acquisition (issue #268)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-sync-lock-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("maps timeout to DB_LOCKED", async () => {
    vi.mocked(acquireProcessLock).mockRejectedValueOnce(
      new ProcessLockTimeoutError("/x.lock"),
    );
    const run = withSyncStateLock(tmpDir, async () => {});

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
    vi.mocked(acquireProcessLock).mockRejectedValueOnce(ioError);
    const run = withSyncStateLock(tmpDir, async () => {});

    await expect(run).rejects.toBe(ioError);
  });

  it("releases the delegated handle when the callback throws", async () => {
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
