import { describe, it, expect } from "vitest";
import { ReadWriteLock } from "./read-write-lock.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("ReadWriteLock", () => {
  it("should allow multiple readers to hold the lock concurrently", async () => {
    // Arrange
    const lock = new ReadWriteLock();
    let concurrentReaders = 0;
    let peakReaders = 0;

    const read = () =>
      lock.runRead(async () => {
        concurrentReaders++;
        peakReaders = Math.max(peakReaders, concurrentReaders);
        await tick();
        concurrentReaders--;
      });

    // Act
    await Promise.all([read(), read(), read()]);

    // Assert
    expect(peakReaders).toBe(3);
  });

  it("should serialize writers exclusively", async () => {
    // Arrange
    const lock = new ReadWriteLock();
    let activeWriters = 0;
    let peakWriters = 0;
    const order: number[] = [];

    const write = (id: number) =>
      lock.runWrite(async () => {
        activeWriters++;
        peakWriters = Math.max(peakWriters, activeWriters);
        await tick();
        order.push(id);
        activeWriters--;
      });

    // Act
    await Promise.all([write(1), write(2), write(3)]);

    // Assert
    expect(peakWriters).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it("should make a writer wait for active readers and block later readers behind it", async () => {
    // Arrange
    const lock = new ReadWriteLock();
    const events: string[] = [];
    let releaseReader!: () => void;
    const readerGate = new Promise<void>(
      (resolve) => (releaseReader = resolve),
    );

    // Act
    const reader1 = lock.runRead(async () => {
      events.push("reader1-start");
      await readerGate;
      events.push("reader1-end");
    });
    await tick();

    const writer = lock.runWrite(async () => {
      events.push("writer");
    });
    await tick();

    // A reader arriving after a queued writer must wait behind it (no writer starvation).
    const reader2 = lock.runRead(async () => {
      events.push("reader2");
    });
    await tick();

    expect(events).toEqual(["reader1-start"]);
    releaseReader();
    await Promise.all([reader1, writer, reader2]);

    // Assert
    expect(events).toEqual([
      "reader1-start",
      "reader1-end",
      "writer",
      "reader2",
    ]);
  });

  it("should release the lock when the guarded function throws", async () => {
    // Arrange
    const lock = new ReadWriteLock();
    const events: string[] = [];

    // Act — first write throws
    await expect(
      lock.runWrite(async () => {
        events.push("write1:start");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Assert — lock must be reusable after the failure
    const result = await lock.runWrite(async () => {
      events.push("write2:start");
      return "recovered";
    });
    expect(result).toBe("recovered");
    expect(events).toEqual(["write1:start", "write2:start"]);
  });

  it("should allow a new writer to acquire the lock after a previous writer completes (full acquire/release/re-acquire cycle)", async () => {
    const lock = new ReadWriteLock();
    const events: string[] = [];

    // First acquisition
    await lock.runWrite(async () => {
      events.push("acquire-1");
    });
    expect(events).toEqual(["acquire-1"]);

    // Second acquisition — proves the lock was fully released
    await lock.runWrite(async () => {
      events.push("acquire-2");
    });
    expect(events).toEqual(["acquire-1", "acquire-2"]);

    // Third acquisition — confirms repeated cycling works
    await lock.runWrite(async () => {
      events.push("acquire-3");
    });
    expect(events).toEqual(["acquire-1", "acquire-2", "acquire-3"]);
  });

  it("should serialize a writer after a reader completes (reader-to-writer handoff)", async () => {
    const lock = new ReadWriteLock();
    const events: string[] = [];

    await lock.runRead(async () => {
      events.push("read");
    });
    expect(events).toEqual(["read"]);

    await lock.runWrite(async () => {
      events.push("write");
    });
    expect(events).toEqual(["read", "write"]);
  });
});
