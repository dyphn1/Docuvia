/**
 * ReadWriteLock — dependency-free, promise-based read/write lock queue (ADR-032).
 *
 * Allows multiple concurrent readers while granting writers exclusive access. Waiters are
 * served in FIFO order; once a writer is queued, later readers wait behind it so writers
 * cannot be starved. Used by `GraphStore` to serialize SQLite writes so parallel callers never
 * crash with SQLITE_BUSY ("database is locked").
 */
/** Waiter kind in {@link ReadWriteLock}'s FIFO queue. */
const LockWaiterKind = {
  READ: "read",
  WRITE: "write",
} as const;
type LockWaiterKindType = (typeof LockWaiterKind)[keyof typeof LockWaiterKind];

export class ReadWriteLock {
  private activeReaders = 0;
  private writerActive = false;
  private queue: Array<{ kind: LockWaiterKindType; grant: () => void }> = [];

  /** Runs `fn` while holding a shared read lock. */
  public async runRead<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquireRead();
    try {
      return await fn();
    } finally {
      this.releaseRead();
    }
  }

  /** Runs `fn` while holding the exclusive write lock. */
  public async runWrite<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquireWrite();
    try {
      return await fn();
    } finally {
      this.releaseWrite();
    }
  }

  private acquireRead(): Promise<void> {
    // Fast path: no writer active and no writer waiting ahead of us.
    if (
      !this.writerActive &&
      !this.queue.some((waiter) => waiter.kind === LockWaiterKind.WRITE)
    ) {
      this.activeReaders++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push({ kind: LockWaiterKind.READ, grant: resolve });
    });
  }

  private releaseRead(): void {
    this.activeReaders--;
    this.dispatch();
  }

  private acquireWrite(): Promise<void> {
    if (
      !this.writerActive &&
      this.activeReaders === 0 &&
      this.queue.length === 0
    ) {
      this.writerActive = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push({ kind: LockWaiterKind.WRITE, grant: resolve });
    });
  }

  private releaseWrite(): void {
    this.writerActive = false;
    this.dispatch();
  }

  private dispatch(): void {
    if (this.writerActive) return;

    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (next.kind === LockWaiterKind.WRITE) {
        if (this.activeReaders === 0) {
          this.queue.shift();
          this.writerActive = true;
          next.grant();
        }
        // Either the writer just got the lock, or readers are still draining —
        // in both cases nothing behind the writer may start yet.
        return;
      }
      this.queue.shift();
      this.activeReaders++;
      next.grant();
    }
  }
}
