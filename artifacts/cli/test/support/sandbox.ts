import { execa, Options as ExecaOptions } from "execa";
import { resolve, join } from "path";
import { mkdtemp, rm, mkdir, open, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import Database from "better-sqlite3";

const CLI_PATH = resolve(__dirname, "../../src/cli.ts");
const CLI_DIR = resolve(__dirname, "../..");
const CLI_DIST_PATH = resolve(CLI_DIR, "dist/cli.js");
const CLI_BUILD_LOCK_PATH = resolve(CLI_DIR, ".test-cli-build.lock");
const CLI_BUILD_LOCK_TIMEOUT_MS = 120_000;
const CLI_BUILD_LOCK_RETRY_MS = 100;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function acquireCliBuildLock() {
  const deadline = Date.now() + CLI_BUILD_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      return await open(CLI_BUILD_LOCK_PATH, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for the CLI build lock at ${CLI_BUILD_LOCK_PATH}`,
        );
      }
      await new Promise<void>((resolvePromise) =>
        setTimeout(resolvePromise, CLI_BUILD_LOCK_RETRY_MS),
      );
    }
  }
}

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
      await execa("git", ["config", "user.name", "Test User"], {
        cwd: this.dir,
      });
      await execa("git", ["config", "user.email", "test@example.com"], {
        cwd: this.dir,
      });
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
        await rm(this.dir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      } catch (err) {
        process.emitWarning(
          `Failed to cleanup sandbox dir ${this.dir}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Run a CLI command within this sandbox.
   *
   * Note: unlike old Docuvia's sandbox, this does not inject
   * `AI_INTEGRATIONS_OPENAI_BASE_URL`/`AI_INTEGRATIONS_OPENAI_API_KEY`/`DATABASE_URL` —
   * those were Postgres/LLM-API-server concerns tied to old Docuvia's server-backed
   * surfaces. Docuvia2's `init` pipeline makes no Postgres or LLM calls (see the
   * migration plan's "lib/llm-orchestrator ... deferred" note), so no subprocess path
   * reads them.
   */
  runCli(args: string[], options?: ExecaOptions) {
    const tsxBin = resolve(
      __dirname,
      `../../node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`,
    );
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
   * Run a command against the *compiled* `dist/cli.js` via plain `node` — not `tsx`. Every other
   * `runCli()` invocation in this suite runs from TypeScript source via `tsx`, whose loader
   * quietly papers over bugs that only exist in the bundled build (duplicated shebangs, workers
   * that need a real standalone `.js` file, assets like the tree-sitter wasm/grammar files and
   * SQL migrations that a bundler can relocate away from their `__dirname`-relative source
   * layout). Use this — not `runCli()` — for any test asserting "the shipped CLI actually works",
   * since that's the one thing `tsx`-based tests structurally cannot catch. Requires `dist/cli.js`
   * to already be built (see `buildDistCli()`).
   */
  runDistCli(args: string[], options?: ExecaOptions) {
    return execa(process.execPath, [CLI_DIST_PATH, ...args], {
      cwd: this.dir,
      ...options,
      env: {
        ...process.env,
        ...options?.env,
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

/**
 * Builds `dist/cli.js` via `tsup` for tests that use `TestSandbox.runDistCli()`. The output is
 * shared by several integration files, so concurrent callers serialize the first build and reuse
 * its complete output instead of letting tsup's clean step delete files another test is using.
 */
export async function buildDistCli(): Promise<void> {
  if (await fileExists(CLI_DIST_PATH)) return;

  const lock = await acquireCliBuildLock();
  try {
    if (await fileExists(CLI_DIST_PATH)) return;
    await execa("npx", ["tsup"], { cwd: CLI_DIR });
  } finally {
    try {
      await lock.close();
    } finally {
      await rm(CLI_BUILD_LOCK_PATH, { force: true });
    }
  }
}
