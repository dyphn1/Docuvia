import { execa, Options as ExecaOptions } from "execa";
import { resolve, join } from "path";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import Database from "better-sqlite3";

const CLI_PATH = resolve(__dirname, "../../src/cli.ts");

export interface SandboxOptions {
  /** Mock files to create in the sandbox. Key is relative path, value is content. */
  files?: Record<string, string>;
  /** Initialize a git repository in the sandbox */
  initGit?: boolean;
}

export type SandboxAction = (sandbox: TestSandbox) => Promise<void>;

export class TestSandbox {
  public dir!: string;

  /**
   * Setup a new clean sandbox environment.
   */
  async setup(options: SandboxOptions = {}) {
    this.dir = await mkdtemp(resolve(tmpdir(), "docuvia-cli-test-"));

    if (options.initGit) {
      await execa("git", ["init"], { cwd: this.dir });
      // Set dummy user for git commits to avoid issues in CI
      await execa("git", ["config", "user.name", "Test User"], { cwd: this.dir });
      await execa("git", ["config", "user.email", "test@example.com"], { cwd: this.dir });
    }

    if (options.files) {
      for (const [relativePath, content] of Object.entries(options.files)) {
        const fullPath = resolve(this.dir, relativePath);
        const dirPath = resolve(fullPath, "..");
        await mkdir(dirPath, { recursive: true });
        await writeFile(fullPath, content, "utf-8");
      }
    }
  }

  /**
   * Tear down the sandbox environment.
   */
  async teardown() {
    if (this.dir) {
      try {
        await rm(this.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (err) {
        console.warn(`Failed to cleanup sandbox dir ${this.dir}:`, err);
      }
    }
  }

  /**
   * Run a CLI command within this sandbox.
   */
  runCli(args: string[], options?: ExecaOptions) {
    const tsxBin = resolve(__dirname, "../../../../node_modules/.bin/tsx.cmd");
    return execa(tsxBin, [CLI_PATH, ...args], {
      cwd: this.dir,
      ...options,
      env: {
        ...process.env,
        ...options?.env,
        // Ensure test environment
        NODE_ENV: "test",
      },
    });
  }

  /**
   * Run a Git command within this sandbox to verify Git state (e.g. orphan branches)
   */
  async runGit(args: string[]) {
    return execa("git", args, { cwd: this.dir });
  }

  /**
   * Get a read-only database connection to the local.db in the sandbox
   */
  getDb(): Database.Database {
    const dbPath = join(this.dir, ".docuvia/local.db");
    return new Database(dbPath, { readonly: true });
  }

  /**
   * Execute a composable sequence of actions to simulate a complex user journey
   */
  async runScenario(...actions: SandboxAction[]) {
    for (const action of actions) {
      await action(this);
    }
  }
}
