import { AstSink, AstEvent } from '@workspace/ast-core';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import os from 'os';
import path from 'path';

export class DiskJsonlSink implements AstSink {
  private tempFilePath: string;
  private stream: ReturnType<typeof createWriteStream> | null = null;
  private isReady: Promise<void>;

  constructor() {
    this.tempFilePath = path.join(os.tmpdir(), `ast-sink-${Date.now()}-${Math.random().toString(36).substring(2, 15)}.jsonl`);
    this.isReady = this.init();
  }

  private async init() {
    this.stream = createWriteStream(this.tempFilePath, { flags: 'a', encoding: 'utf-8' });
  }

  get filePath(): string {
    return this.tempFilePath;
  }

  async emit(event: AstEvent): Promise<void> {
    await this.isReady;
    if (!this.stream) throw new Error('Stream not initialized');
    
    const data = JSON.stringify(event) + '\n';
    if (!this.stream.write(data)) {
      await new Promise(resolve => this.stream?.once('drain', resolve));
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
