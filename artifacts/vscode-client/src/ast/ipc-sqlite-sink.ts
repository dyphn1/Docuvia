import { AstSink, AstEvent } from "@workspace/ast-core";

export class IpcSqliteSink implements AstSink {
  private buffer: AstEvent[] = [];
  private batchSize = 100;

  emit(event: AstEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.batchSize) {
      this.flushBatch();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length > 0) {
      this.flushBatch();
    }
    // We send a flush message so the host knows we are done.
    (globalThis as any).postMessage({ type: "flush" });
  }

  private flushBatch() {
    (globalThis as any).postMessage({ type: "ast-events", events: [...this.buffer] });
    this.buffer = [];
  }
}
