import fs from "fs/promises";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath, pathToFileURL } from "url";
import { ensureLocalFtsIndex } from "./sqlite-fts.js";
import { TempFileManager } from "./temp-file-manager.js";
import { logger } from "../utils/logger.js";
import { IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";
import { WorkspaceGitService } from "./workspace-git.service.js";
import {
  IFileDiscovery,
  IAstProcessor,
  IGraphDatabaseRepository,
  IConfigScanner,
  IVcsScanner,
} from "../interfaces/analyzer.interfaces.js";
import { FileDiscoveryService } from "./file-discovery.service.js";
import { AstProcessingService } from "./ast-processing.service.js";
import { SqliteGraphRepository } from "./sqlite-graph.repository.js";
import { ConfigScannerService } from "./config-scanner.service.js";
import { VcsScannerService } from "./vcs-scanner.service.js";
import { detectLanguageForFile } from "../utils/language-detection.js";
import { appendInitLogLine, writeInitSummary } from "./init-log-writer.js";
import { INIT_SERVICE_MESSAGES } from "../constants/init-service-messages.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class InitService {
  constructor(
    private workspaceRoot: string = process.cwd(),
    private logCallback: (msg: string) => void = (msg) => console.log(msg),
    private workspaceGit: IWorkspaceGitService = new WorkspaceGitService(),
    private fileDiscovery: IFileDiscovery = new FileDiscoveryService(),
    private astProcessor: IAstProcessor = new AstProcessingService(),
    private graphRepository: IGraphDatabaseRepository = new SqliteGraphRepository(),
    private configScanner: IConfigScanner = new ConfigScannerService(),
    private vcsScanner: IVcsScanner = new VcsScannerService()
  ) {}

  public async init() {
    this.logCallback(`Initializing project in ${this.workspaceRoot}...`);
    await appendInitLogLine(this.workspaceRoot, {
      event: "init.start",
      workspaceRoot: this.workspaceRoot,
    });

    // 1. Setup hidden knowledge-graph branch
    await this.workspaceGit.ensureKnowledgeBranch(this.workspaceRoot);

    // 2. Install post-commit hook (non-fatal on failure)
    this.logCallback(`Installing post-commit hook...`);
    await this.workspaceGit.installPostCommitHook(this.workspaceRoot);

    // 3. Initialize SQLite database + register this workspace as the local project
    const docuviaDir = path.join(this.workspaceRoot, ".docuvia");
    const dbPath = path.join(docuviaDir, "local.db");
    try {
      await fs.mkdir(docuviaDir, { recursive: true });
      const db = new Database(dbPath);

      this.logCallback(`Initializing SQLite database...`);
      const schemaSql = await fs.readFile(
        path.join(__dirname, "..", "constants", "schema.sql"),
        "utf8"
      );
      db.exec(schemaSql);
      // FTS5 keyword indexes for the local-first natural language fallback (ADR-029)
      ensureLocalFtsIndex(db);

      // One project per local.db (see GitConstants.DEFAULT_LOCAL_PROJECT_ID) — only seed the
      // row on first init so re-running `docuvia init` stays idempotent.
      const existingProject = db.prepare("SELECT id FROM projects LIMIT 1").get();
      if (!existingProject) {
        const remoteUrl = await this.workspaceGit.getRemoteUrl(this.workspaceRoot);
        const repoUrl = remoteUrl ?? pathToFileURL(path.resolve(this.workspaceRoot)).href;
        db.prepare("INSERT INTO projects (name, repo_url) VALUES (?, ?)").run(
          path.basename(this.workspaceRoot),
          repoUrl
        );
      }

      db.close();
    } catch (err: any) {
      throw new Error(`Could not initialize database: ${err.message}`);
    }

    // 4. Discover, parse, and persist the initial AST graph, tagged with detected
    // config/hotspot/language tags (feature sniffing).
    this.logCallback(`Scanning project files...`);
    const [configResult, hotspotTags, discovery] = await Promise.all([
      this.configScanner.scanConfigs(this.workspaceRoot),
      this.vcsScanner.extractHotspotTags(this.workspaceRoot),
      this.fileDiscovery.discoverFiles(this.workspaceRoot, dbPath),
    ]);

    const tags = new Set<string>([...configResult.tags, ...hotspotTags]);

    this.logCallback(`Parsing ${discovery.filesToParse.length} files...`);
    const { parsed: parsedResults, failures } = await this.astProcessor.processFiles(
      this.workspaceRoot,
      discovery.filesToParse
    );
    for (const result of parsedResults) {
      const language = detectLanguageForFile(result.file);
      if (language) tags.add(language);
    }
    for (const failure of failures) {
      await appendInitLogLine(this.workspaceRoot, { event: "init.parse_failure", ...failure });
    }
    for (const skipped of discovery.skippedOversized) {
      await appendInitLogLine(this.workspaceRoot, {
        event: "init.file_skipped_oversized",
        ...skipped,
      });
    }

    this.logCallback(`Persisting knowledge graph...`);
    await this.graphRepository.persistAstGraph(this.workspaceRoot, parsedResults, Array.from(tags));

    // 5. Initialize TempFileManager for LSP and incremental updates
    try {
      const tempFileManager = new TempFileManager(this.workspaceRoot);
      await tempFileManager.initialize();
      this.logCallback(`Initializing temp file manager...`);

      // Register cleanup hook on SIGTERM
      const cleanupHandler = async () => {
        logger.info("Cleaning up temp files on shutdown...");
        await tempFileManager.cleanup();
        tempFileManager.stopCleanup();
      };

      process.on("SIGTERM", cleanupHandler);
      process.on("SIGINT", cleanupHandler);

      logger.info({ tempDir: tempFileManager.getTempDirPath() }, "Temp file manager initialized");
    } catch (err: any) {
      logger.warn({ error: err.message }, "Failed to initialize temp file manager (non-fatal)");
    }

    const filesRequested = discovery.filesToParse.length;
    const filesParsed = parsedResults.length;
    const filesFailed = failures.length;
    const filesSkippedOversized = discovery.skippedOversized.length;

    if (filesFailed > 0 || filesSkippedOversized > 0) {
      logger.warn(
        { filesRequested, filesParsed, filesFailed, filesSkippedOversized, failures },
        "init completed with parse failures or skipped files"
      );
    }

    await writeInitSummary(this.workspaceRoot, {
      filesRequested,
      filesParsed,
      filesFailed,
      failures,
      filesSkippedOversized,
    });

    return {
      success: true,
      partialFailure: filesFailed > 0,
      message:
        filesFailed > 0
          ? INIT_SERVICE_MESSAGES.PARTIAL_SUCCESS(filesFailed, filesRequested)
          : filesSkippedOversized > 0
            ? INIT_SERVICE_MESSAGES.SUCCESS_WITH_SKIPPED_OVERSIZED(filesSkippedOversized)
            : INIT_SERVICE_MESSAGES.SUCCESS,
      filesRequested,
      filesParsed,
      filesFailed,
      failures,
      filesSkippedOversized,
    };
  }
}
