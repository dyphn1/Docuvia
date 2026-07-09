import { ENCODING_UTF_8, UTF8_ENCODING } from "@workspace/core";
import { API_MESSAGES } from "@workspace/core";
import { AstSink, AstEvent } from "@workspace/ast-core";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import os from "os";
import path from "path";
import { AST_INGESTION_DEFAULTS } from "../../constants/index.js";

export class DiskJsonlSink implements AstSink {
  private tempFilePath: string;
  private stream: ReturnType<typeof createWriteStream> | null = null;
  private isReady: Promise<void>;

  constructor() {
    this.tempFilePath = path.join(
      os.tmpdir(),
      `${AST_INGESTION_DEFAULTS.TEMP_FILE_PREFIX_SINK}${Date.now()}-${Math.random().toString(36).substring(2, 15)}${AST_INGESTION_DEFAULTS.TEMP_FILE_EXT_JSONL}`
    );
    this.isReady = this.init();
  }

  private async init() {
    this.stream = createWriteStream(this.tempFilePath, {
      flags: AST_INGESTION_DEFAULTS.WRITE_STREAM_FLAG_APPEND,
      encoding: ENCODING_UTF_8,
    });
  }

  get filePath(): string {
    return this.tempFilePath;
  }

  async emit(event: AstEvent): Promise<void> {
    await this.isReady;
    if (!this.stream) throw new Error(API_MESSAGES.STREAM_NOT_INITIALIZED);

    const data = JSON.stringify(event) + AST_INGESTION_DEFAULTS.NEWLINE;
    if (!this.stream.write(data)) {
      await new Promise((resolve) =>
        this.stream?.once(AST_INGESTION_DEFAULTS.EVENT_DRAIN, resolve)
      );
    }
  }

  async flush(): Promise<void> {
    await this.isReady;
    if (this.stream) {
      await new Promise<void>((resolve, reject) => {
        this.stream!.end((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.stream = null;
    }
  }
}
