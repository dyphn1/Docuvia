import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "../../utils/logger.js";

export interface VfsEntry {
  uri: string;
  tempFilePath: string;
  version: number;
  contentHash: string;
  content: string;
  lastKnownContent?: string;
}

export class VirtualFileSystem {
  private index = new Map<string, VfsEntry>();
  private readonly tmpDir: string;

  constructor(tmpDir?: string) {
    // Default to .docuvia/tmp relative to process.cwd()
    this.tmpDir = tmpDir || path.resolve(process.cwd(), ".docuvia/tmp");
  }

  async initialize() {
    await fs.mkdir(this.tmpDir, { recursive: true });
    logger.info({ tmpDir: this.tmpDir }, "VirtualFileSystem initialized");
  }

  async writeDirtyFile(uri: string, content: string, version: number): Promise<VfsEntry> {
    const contentHash = crypto.createHash("sha256").update(content).digest("hex");

    // Create a safe temp file name from the URI
    const safeName = crypto.createHash("md5").update(uri).digest("hex") + ".tmp";
    const tempFilePath = path.join(this.tmpDir, safeName);

    await fs.writeFile(tempFilePath, content, "utf-8");

    const entry: VfsEntry = {
      uri,
      tempFilePath,
      version,
      contentHash,
      content,
      lastKnownContent: "",
    };

    this.index.set(uri, entry);
    logger.debug({ uri, version, tempFilePath }, "Wrote dirty file to VFS overlay");
    return entry;
  }

  async removeDirtyFile(uri: string): Promise<void> {
    const entry = this.index.get(uri);
    if (entry) {
      try {
        await fs.unlink(entry.tempFilePath);
      } catch (err) {
        logger.warn({ uri, err }, "Failed to remove temp file from VFS overlay");
      }
      this.index.delete(uri);
      logger.debug({ uri }, "Removed dirty file from VFS overlay");
    }
  }

  getEntry(uri: string): VfsEntry | undefined {
    return this.index.get(uri);
  }

  async getFileContent(uri: string): Promise<string | undefined> {
    const entry = this.index.get(uri);
    if (!entry) return undefined;
    return entry.content;
  }

  async updateLastKnownContent(uri: string, content: string): Promise<void> {
    const entry = this.index.get(uri);
    if (entry) {
      entry.lastKnownContent = content;
    }
  }

  getAllDirtyFiles(): VfsEntry[] {
    return Array.from(this.index.values());
  }
}
