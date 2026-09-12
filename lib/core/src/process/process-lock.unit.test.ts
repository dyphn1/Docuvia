import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { ProcessLockTimeoutError, UTF8_ENCODING } from "@workspace/contracts";
import { acquireProcessLock } from "./process-lock.js";

const tempDirs: string[] = [];

async function makeLockPath(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "docuvia-process-lock-test-"),
  );
  tempDirs.push(dir);
  return path.join(dir, "test.lock");
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("acquireProcessLock()", () => {
  it("acquires immediately when no lock file exists, and release() removes it", async () => {
    const lockPath = await makeLockPath();

    const lock = await acquireProcessLock(lockPath);
    await expect(fs.readFile(lockPath, UTF8_ENCODING)).resolves.toBe(
      String(process.pid),
    );

    await lock.release();
    await expect(fs.stat(lockPath)).rejects.toThrow();
  });

  it("release() is idempotent", async () => {
    const lockPath = await makeLockPath();
    const lock = await acquireProcessLock(lockPath);

    await lock.release();
    await expect(lock.release()).resolves.toBe(undefined);
  });

  it("waits for a held lock to be released, then acquires it, invoking onWaiting once", async () => {
    const lockPath = await makeLockPath();
    const first = await acquireProcessLock(lockPath);

    let waitingCalls = 0;
    const secondPromise = acquireProcessLock(lockPath, {
      maxWaitMs: 2_000,
      retryIntervalMs: 20,
      onWaiting: () => waitingCalls++,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await first.release();

    const second = await secondPromise;
    expect(waitingCalls).toBe(1);
    await second.release();
  });

  it("throws ProcessLockTimeoutError if the lock is never released", async () => {
    const lockPath = await makeLockPath();
    const holder = await acquireProcessLock(lockPath);

    await expect(
      acquireProcessLock(lockPath, { maxWaitMs: 150, retryIntervalMs: 20 }),
    ).rejects.toBeInstanceOf(ProcessLockTimeoutError);

    await holder.release();
  });

  it("reclaims a stale lock once its mtime is old AND its recorded PID is dead", async () => {
    const lockPath = await makeLockPath();
    const deadPid = 999_999_999;
    await fs.writeFile(lockPath, String(deadPid));
    const longAgo = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, longAgo, longAgo);

    const lock = await acquireProcessLock(lockPath, {
      maxWaitMs: 2_000,
      retryIntervalMs: 20,
      staleAfterMs: 50,
    });

    await expect(fs.readFile(lockPath, UTF8_ENCODING)).resolves.toBe(
      String(process.pid),
    );
    await lock.release();
  });

  it("does not reclaim a lock whose mtime looks stale but whose PID is still alive", async () => {
    const lockPath = await makeLockPath();
    await fs.writeFile(lockPath, String(process.pid));
    const longAgo = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, longAgo, longAgo);

    await expect(
      acquireProcessLock(lockPath, {
        maxWaitMs: 150,
        retryIntervalMs: 20,
        staleAfterMs: 50,
      }),
    ).rejects.toBeInstanceOf(ProcessLockTimeoutError);

    await fs.rm(lockPath, { force: true });
  });

  it("heartbeats the lockfile's mtime while held, so a waiter does not treat a live holder as stale", async () => {
    const lockPath = await makeLockPath();
    const holder = await acquireProcessLock(lockPath, {
      heartbeatIntervalMs: 30,
    });

    await expect(
      acquireProcessLock(lockPath, {
        maxWaitMs: 200,
        retryIntervalMs: 20,
        staleAfterMs: 10,
      }),
    ).rejects.toBeInstanceOf(ProcessLockTimeoutError);

    await holder.release();
  });
});
