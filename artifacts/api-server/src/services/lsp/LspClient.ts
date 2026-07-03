import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import { pathToFileURL } from "url";
import { logger } from "@workspace/core";

export interface LspMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

export class LspClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private messageId = 1;
  private pendingRequests = new Map<
    number | string,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();
  private buffer: string = "";

  constructor(
    public readonly languageId: string,
    private readonly command: string,
    private readonly args: string[]
  ) {
    super();
  }

  private rejectAllPendingRequests(reason: string) {
    for (const [id, req] of this.pendingRequests.entries()) {
      req.reject(new Error(`LSP Request ${id} failed: ${reason}`));
    }
    this.pendingRequests.clear();
  }

  async start(workspaceRoot: string): Promise<void> {
    this.process = spawn(this.command, this.args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!this.process || !this.process.stdout || !this.process.stdin) {
      throw new Error(`Failed to spawn LSP process: ${this.command}`);
    }

    this.process.stdout.on("data", (data: Buffer) => this.handleData(data));
    this.process.stderr?.on("data", (data: Buffer) => {
      logger.debug({ languageId: this.languageId, err: data.toString() }, "LSP stderr");
    });

    this.process.on("error", (err) => {
      logger.error({ languageId: this.languageId, err }, "LSP process error");
      this.rejectAllPendingRequests(`Process error: ${err.message}`);
      this.emit("error", err);
    });

    this.process.on("exit", (code) => {
      logger.info({ languageId: this.languageId, code }, "LSP process exited");
      this.rejectAllPendingRequests(`Process exited with code ${code}`);
      this.emit("exit", code);
    });

    // Send initialize request
    const rootUri = pathToFileURL(workspaceRoot).toString();
    await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri: rootUri,
      capabilities: {},
      workspaceFolders: [
        {
          uri: rootUri,
          name: "workspace",
        },
      ],
    });

    // Send initialized notification
    this.sendNotification("initialized", {});
    logger.info({ languageId: this.languageId }, "LSP Client initialized");
  }

  private handleData(data: Buffer) {
    this.buffer += data.toString("utf-8");

    while (true) {
      const match = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!match) break;

      const contentLength = parseInt(match[1], 10);
      const messageStart = match.index! + match[0].length;

      if (this.buffer.length < messageStart + contentLength) {
        // Not enough data yet
        break;
      }

      const messageStr = this.buffer.slice(messageStart, messageStart + contentLength);
      this.buffer = this.buffer.slice(messageStart + contentLength);

      try {
        const message = JSON.parse(messageStr) as LspMessage;
        this.handleMessage(message);
      } catch (err) {
        logger.error({ err, messageStr }, "Failed to parse LSP message");
      }
    }
  }

  private handleMessage(message: LspMessage) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      // It's a response
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        if (message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
        this.pendingRequests.delete(message.id);
      }
    } else if (message.method) {
      // It's a notification or request from server
      this.emit("notification", message);
      this.emit(message.method, message.params);
    }
  }

  public sendNotification(method: string, params: any): void {
    const message: LspMessage = {
      jsonrpc: "2.0",
      method,
      params,
    };
    try {
      this.writeMessage(message);
    } catch (err) {
      logger.warn({ err }, "Failed to send notification");
    }
  }

  public sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      const message: LspMessage = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      try {
        this.writeMessage(message);
        this.pendingRequests.set(id, { resolve, reject });
      } catch (err) {
        reject(err);
      }
    });
  }

  private writeMessage(message: LspMessage): void {
    if (!this.process || !this.process.stdin) {
      throw new Error("Cannot write message, LSP process not running");
    }

    const jsonStr = JSON.stringify(message);
    const payload = `Content-Length: ${Buffer.byteLength(jsonStr, "utf-8")}\r\n\r\n${jsonStr}`;
    this.process.stdin.write(payload);
  }

  public stop(): void {
    if (this.process) {
      this.sendNotification("exit", {});
      this.process.kill();
      this.process = null;
    }
    this.rejectAllPendingRequests("LSP client stopped");
  }
}
