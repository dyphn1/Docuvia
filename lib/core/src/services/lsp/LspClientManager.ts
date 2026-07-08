import { logger } from "../../utils/logger.js";
import { VirtualFileSystem } from "./VirtualFileSystem.js";
import { LspClient } from "./LspClient.js";
import { calculateLineDiff } from "../../utils/lsp-diff-calculator.js";

export interface LspConfig {
  command: string;
  args: string[];
}

export class LspClientManager {
  private clients = new Map<string, LspClient>();
  private readonly vfs: VirtualFileSystem;
  private readonly workspaceRoot: string;
  private readonly configs: Record<string, LspConfig>;

  constructor(vfs: VirtualFileSystem, workspaceRoot: string, configs?: Record<string, LspConfig>) {
    this.vfs = vfs;
    this.workspaceRoot = workspaceRoot;
    // Default configs for common languages
    this.configs = configs || {
      typescript: { command: "typescript-language-server", args: ["--stdio"] },
      javascript: { command: "typescript-language-server", args: ["--stdio"] },
      python: { command: "pyright-langserver", args: ["--stdio"] },
    };
  }

  async getClient(languageId: string): Promise<LspClient> {
    if (this.clients.has(languageId)) {
      return this.clients.get(languageId)!;
    }

    const config = this.configs[languageId];
    if (!config) {
      throw new Error(`No LSP configuration for language: ${languageId}`);
    }

    const client = new LspClient(languageId, config.command, config.args);
    await client.start(this.workspaceRoot);
    this.clients.set(languageId, client);
    return client;
  }

  async notifyFileOpened(
    uri: string,
    languageId: string,
    content: string,
    version: number
  ): Promise<void> {
    const client = await this.getClient(languageId);

    // Store in VFS
    await this.vfs.writeDirtyFile(uri, content, version);

    // Notify LSP
    client.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version,
        text: content,
      },
    });
  }

  async notifyFileChanged(uri: string, languageId: string, version: number): Promise<void> {
    // Content should be written to VFS BEFORE calling this
    const entry = this.vfs.getEntry(uri);
    if (!entry) {
      logger.error({ uri }, "Failed to find file in VFS for didChange");
      return;
    }

    const content = entry.content;
    if (content === undefined) {
      logger.error({ uri }, "Failed to read file content from VFS for didChange");
      return;
    }

    const client = await this.getClient(languageId);

    const lastKnownContent = entry.lastKnownContent || "";
    const diffResult = calculateLineDiff(lastKnownContent, content);

    if (diffResult.full) {
      // Send full content sync for large changes
      logger.debug({ uri, version }, "Sending full content sync (>30% changed)");
      client.sendNotification("textDocument/didChange", {
        textDocument: {
          uri,
          version,
        },
        contentChanges: [
          {
            text: content,
          },
        ],
      });
    } else if (diffResult.changes.length > 0) {
      // Send incremental changes
      logger.debug(
        { uri, version, changeCount: diffResult.changes.length },
        "Sending incremental changes"
      );
      client.sendNotification("textDocument/didChange", {
        textDocument: {
          uri,
          version,
        },
        contentChanges: diffResult.changes.map((change) => {
          if (change.type === "insert") {
            return {
              range: {
                start: { line: change.startLine, character: 0 },
                end: { line: change.startLine, character: 0 },
              },
              text: change.newText + "\n",
            };
          } else if (change.type === "delete" && change.endLine !== undefined) {
            return {
              range: {
                start: { line: change.startLine, character: 0 },
                end: { line: change.endLine + 1, character: 0 },
              },
              text: "",
            };
          } else {
            // replace
            return {
              range: {
                start: { line: change.startLine, character: 0 },
                end: {
                  line: (change.endLine ?? change.startLine) + 1,
                  character: 0,
                },
              },
              text: change.newText + "\n",
            };
          }
        }),
      });
    } else {
      // No changes
      logger.debug({ uri, version }, "No content changes");
    }

    // Update last known content for next diff
    await this.vfs.updateLastKnownContent(uri, content);
  }

  async notifyFileClosed(uri: string, languageId: string): Promise<void> {
    // Remove from VFS
    await this.vfs.removeDirtyFile(uri);

    const client = this.clients.get(languageId);
    if (client) {
      client.sendNotification("textDocument/didClose", {
        textDocument: {
          uri,
        },
      });
    }
  }

  stopAll(): void {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
  }
}
