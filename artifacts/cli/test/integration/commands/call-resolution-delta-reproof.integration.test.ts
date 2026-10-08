import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  AnalyzeResultKind,
  createNoopLogger,
  DocuviaError,
  docuviaMemory,
  ErrorCodes,
  MemoryKeys,
} from "@workspace/contracts";
import { GitLocalProvider } from "@workspace/git-local";
import { docuviaApi } from "@workspace/ui-core";
import { TestSandbox } from "../../support/sandbox.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import "../../../src/registration.js";

const initialSources: Record<string, string> = {
  ".gitignore": ".docuvia/\n",
  "src/target.ts":
    'export function greet(name: string): string { return `hello ${name}`; }\nexport function barrelWork(): string { return "barrel A"; }\n',
  "src/barrel.ts": 'export { barrelWork } from "./target.js";\n',
  "src/stable.ts":
    'export function stableWork(): string { return "stable"; }\n',
  "src/service.ts":
    "class Service { run(): string { return 'service'; } }\nexport const service = new Service();\n",
  "src/service-barrel.ts": 'export { service } from "./service.js";\n',
  "src/service-caller.ts":
    'import { service } from "./service-barrel.js";\nexport function serviceCaller() { return service.run(); }\n',
  "src/barrel-caller.ts":
    'import { barrelWork } from "./barrel.js";\nexport function barrelCaller() { return barrelWork(); }\n',
  "src/direct-caller.ts":
    'import { greet } from "./target.js";\nimport { stableWork } from "./stable.js";\nexport function stableCaller() { return stableWork(); }\nexport function directCaller() { return greet("direct"); }\n',
  "src/old-caller.ts":
    'import { greet } from "./target.js";\nexport function renamedCaller() { return greet("rename"); }\n',
  "src/deleted-caller.ts":
    'import { greet } from "./target.js";\nexport function deletedCaller() { return greet("delete"); }\n',
};

const renamedCaller = initialSources["src/old-caller.ts"]!;

const changedSources: Record<string, string> = {
  ".gitignore": initialSources[".gitignore"]!,
  "src/stable.ts": initialSources["src/stable.ts"]!,
  "src/service.ts": initialSources["src/service.ts"]!,
  "src/service-barrel.ts":
    '// barrel changed to invalidate the caller\nexport { service } from "./service.js";\n',
  "src/service-caller.ts":
    '// caller changed to force a fresh ScopeResolver projection\nimport { service } from "./service-barrel.js";\nexport function serviceCaller() { return service.run(); }\n',
  "src/target.ts":
    "export function greet(name: string): string { return `welcome ${name}!`; }\n",
  "src/barrel.ts": 'export { barrelWork } from "./alternate.js";\n',
  "src/alternate.ts":
    'export function barrelWork(): string { return "barrel B"; }\nexport function newWork(): string { return "new"; }\n',
  "src/barrel-caller.ts": initialSources["src/barrel-caller.ts"]!,
  "src/direct-caller.ts": initialSources["src/direct-caller.ts"]!,
  "src/renamed-caller.ts": renamedCaller,
  "src/new-caller.ts":
    'import { newWork } from "./alternate.js";\nexport function newCaller() { return newWork(); }\n',
  "src/new-receiver.ts":
    "class Receiver { run(): string { return 'receiver'; } }\nexport function newReceiverCaller() { return new Receiver().run(); }\n",
};

type ProvenRow = {
  call_site_key: string;
  caller_node_key: string;
  selected_target_node_key: string | null;
  rule_signature: string;
};

type CallEdge = { source_node_key: string; target_node_key: string };

type GraphSnapshot = { provenRows: ProvenRow[]; calls: CallEdge[] };
type Constructor<T> = abstract new (...args: never[]) => T;

function instantiate<T>(constructor: Constructor<T>, args: unknown[]): T {
  return Reflect["construct"](constructor, args) as T;
}

function readGraphSnapshot(workspaceRoot: string): GraphSnapshot {
  const db = instantiate<InstanceType<typeof Database>>(Database, [
    `${workspaceRoot}/.docuvia/local.db`,
    { readonly: true },
  ]);
  try {
    return {
      provenRows: db
        .prepare(
          `SELECT call_site_key, caller_node_key, selected_target_node_key, rule_signature
           FROM call_site_resolutions
           WHERE resolution_class = 'proven' AND resolver = 'strict-proof'
           ORDER BY call_site_key, caller_node_key, selected_target_node_key, rule_signature`,
        )
        .all() as ProvenRow[],
      calls: db
        .prepare(
          `SELECT source.node_key AS source_node_key, target.node_key AS target_node_key
           FROM node_links AS edge
           JOIN l2_nodes AS source ON source.id = edge.source_node_id
           JOIN l2_nodes AS target ON target.id = edge.target_node_id
           WHERE edge.link_type = 'calls'
           ORDER BY source.node_key, target.node_key`,
        )
        .all() as CallEdge[],
    };
  } finally {
    db.close();
  }
}

function readProjectFileHashes(
  workspaceRoot: string,
): Map<string, string | null> {
  const db = instantiate<InstanceType<typeof Database>>(Database, [
    `${workspaceRoot}/.docuvia/local.db`,
    { readonly: true },
  ]);
  try {
    const rows = db
      .prepare(
        "SELECT file_path, content_hash FROM project_files ORDER BY file_path",
      )
      .all() as { file_path: string; content_hash: string | null }[];
    return new Map(
      rows.map(({ file_path, content_hash }) => [file_path, content_hash]),
    );
  } finally {
    db.close();
  }
}

async function commitAll(sandbox: TestSandbox, message: string): Promise<void> {
  const runGit = sandbox.runGit.bind(sandbox);
  await runGit(["add", "-A"]);
  await runGit(["-c", "core.hooksPath=/dev/null", "commit", "-m", message]);
}

async function commitPaths(
  sandbox: TestSandbox,
  message: string,
  paths: readonly string[],
): Promise<void> {
  await sandbox.runGit(["add", "-A", "--", ...paths]);
  await sandbox.runGit([
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    message,
  ]);
}

async function latestDeltaSummary(
  workspaceRoot: string,
): Promise<Record<string, unknown>> {
  const fs = await import("node:fs/promises");
  const lines = (
    await fs.readFile(`${workspaceRoot}/.docuvia/logs/analyze.log`, "utf8")
  )
    .split("\n")
    .filter(Boolean);
  const summaries = lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(({ event }) => event === "analyze.delta.summary");
  return summaries.at(-1) ?? {};
}

async function initializeAtCurrentCommit(
  sandbox: TestSandbox,
  scopeId: string,
): Promise<void> {
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, sandbox.dir);
  await docuviaApi.init(scopeId, createNoopLogger());
}

describe("delta strict-proof reproof matches a fresh full init", () => {
  const sandboxes: TestSandbox[] = [];
  const scopes: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const scope of scopes.splice(0)) docuviaMemory.deleteScope(scope);
    await Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.teardown()));
  });

  it(
    "[happy] [state-diff] re-derives Q1/Q2/Q3 proofs after target, caller, rename/delete, and barrel changes",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      await deltaSandbox.setup({ initGit: true, files: initialSources });
      await commitAll(deltaSandbox, "commit A: proof baseline");

      const deltaScope = `delta-reproof-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);
      const baselineSha = (
        await deltaSandbox.runGit(["rev-parse", "HEAD"])
      ).stdout.trim();
      const baselineDb = instantiate<InstanceType<typeof Database>>(Database, [
        `${deltaSandbox.dir}/.docuvia/local.db`,
        { readonly: true },
      ]);
      expect(
        baselineDb
          .prepare("SELECT value FROM docuvia_meta WHERE key = ?")
          .get("callResolutionSourceIndexSha"),
      ).toEqual({ value: baselineSha });
      baselineDb.close();

      for (const [filePath, source] of Object.entries(changedSources)) {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const fullPath = path.join(deltaSandbox.dir, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, source, "utf8");
      }
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.rm(path.join(deltaSandbox.dir, "src/old-caller.ts"));
      await fs.rm(path.join(deltaSandbox.dir, "src/deleted-caller.ts"));
      await commitAll(deltaSandbox, "commit B: update proof dependencies");

      const deltaResult = await docuviaApi.analyze(
        deltaScope,
        createNoopLogger(),
      );
      expect(deltaResult.kind).toBe(AnalyzeResultKind.AUTO_DELTA);

      await fullSandbox.setup({ initGit: true, files: changedSources });
      await commitAll(fullSandbox, "commit B: full-init reference");
      const fullScope = `full-reproof-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);

      const deltaSnapshot = readGraphSnapshot(deltaSandbox.dir);
      const fullSnapshot = readGraphSnapshot(fullSandbox.dir);
      const fsPromises = await import("node:fs/promises");
      const analyzeLog = await fsPromises.readFile(
        `${deltaSandbox.dir}/.docuvia/logs/analyze.log`,
        "utf8",
      );
      const deltaSummary = analyzeLog
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find(({ event }) => event === "analyze.delta.summary");
      expect(deltaSummary).toMatchObject({
        strictProofReproofStatus: "complete",
      });
      expect(
        fullSnapshot.provenRows.map(({ rule_signature }) => rule_signature),
      ).toContain("q1:named-import:v1");
      expect(
        fullSnapshot.provenRows.some(
          ({ rule_signature }) => rule_signature === "q2:reexport-trace:v1",
        ),
      ).toBe(true);
      expect(
        fullSnapshot.provenRows.some(
          ({ rule_signature }) => rule_signature === "q3:new-receiver:v1",
        ),
      ).toBe(true);
      expect(
        fullSnapshot.provenRows.map(
          ({ selected_target_node_key }) => selected_target_node_key,
        ),
        JSON.stringify(fullSnapshot.provenRows),
      ).toContain("src/stable.ts#stableWork");
      expect(
        fullSnapshot.calls.some(
          ({ source_node_key, target_node_key }) =>
            source_node_key === "src/service-caller.ts#serviceCaller" &&
            target_node_key.startsWith("src/service.ts#") &&
            target_node_key.includes("run"),
        ),
      ).toBe(true);
      expect(
        fullSnapshot.provenRows.filter(
          ({ caller_node_key }) =>
            caller_node_key === "src/service-caller.ts#serviceCaller",
        ),
      ).toHaveLength(0);
      expect(deltaSnapshot.provenRows).toEqual(fullSnapshot.provenRows);
      expect(
        deltaSnapshot.calls,
        JSON.stringify({
          delta: deltaSnapshot.calls,
          full: fullSnapshot.calls,
        }),
      ).toEqual(fullSnapshot.calls);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[error-handling] [state-diff] recovers after a dirty-worktree fallback on the next clean commit",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const initialFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "hello"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
        "src/other.ts": "export function other() { return 1; }\n",
      };
      await deltaSandbox.setup({ initGit: true, files: initialFiles });
      await commitAll(deltaSandbox, "commit A: clean source index");
      const deltaScope = `delta-dirty-recovery-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);

      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const targetAtB = 'export function greet() { return "welcome"; }\n';
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/target.ts"),
        targetAtB,
        "utf8",
      );
      await fs.writeFile(path.join(deltaSandbox.dir, "notes.txt"), "dirty\n");
      await commitPaths(deltaSandbox, "commit B: target changes", [
        "src/target.ts",
      ]);
      await docuviaApi.analyze(deltaScope, createNoopLogger());
      expect(await latestDeltaSummary(deltaSandbox.dir)).toMatchObject({
        strictProofReproofStatus: "scope-resolver-fallback",
        strictProofReproofFallbackReason:
          "working-tree-has-uncommitted-changes",
      });

      await fs.rm(path.join(deltaSandbox.dir, "notes.txt"));
      const otherAtC = "export function other() { return 2; }\n";
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/other.ts"),
        otherAtC,
        "utf8",
      );
      await commitPaths(deltaSandbox, "commit C: clean recovery", [
        "src/other.ts",
      ]);
      await docuviaApi.analyze(deltaScope, createNoopLogger());

      const fullFiles = {
        ...initialFiles,
        "src/target.ts": targetAtB,
        "src/other.ts": otherAtC,
      };
      await fullSandbox.setup({ initGit: true, files: fullFiles });
      await commitAll(fullSandbox, "commit C: full-init reference");
      const fullScope = `full-dirty-recovery-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);

      expect(await latestDeltaSummary(deltaSandbox.dir)).toMatchObject({
        strictProofReproofStatus: "complete",
      });
      expect(readGraphSnapshot(deltaSandbox.dir)).toEqual(
        readGraphSnapshot(fullSandbox.dir),
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[invalid-input] reparses a source-index row produced from discarded dirty content",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const callerAtA =
        'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n';
      const target = 'export function greet() { return "hello"; }\n';
      const otherAtA = "export function other() { return 1; }\n";
      const initialFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": target,
        "src/caller.ts": callerAtA,
        "src/other.ts": otherAtA,
      };
      await deltaSandbox.setup({ initGit: true, files: initialFiles });
      await commitAll(deltaSandbox, "commit A: clean source index");
      const deltaScope = `delta-dirty-row-${Date.now()}`;
      scopes.push(deltaScope);

      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/caller.ts"),
        `${callerAtA}export function dirtyOnly() { return 2; }\n`,
        "utf8",
      );
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/caller.ts"),
        callerAtA,
        "utf8",
      );

      const otherAtB = "export function other() { return 2; }\n";
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/other.ts"),
        otherAtB,
        "utf8",
      );
      await commitPaths(deltaSandbox, "commit B: unrelated clean change", [
        "src/other.ts",
      ]);
      await docuviaApi.analyze(deltaScope, createNoopLogger());

      await fullSandbox.setup({
        initGit: true,
        files: { ...initialFiles, "src/other.ts": otherAtB },
      });
      await commitAll(fullSandbox, "commit B: full-init reference");
      const fullScope = `full-dirty-row-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);

      const summary = await latestDeltaSummary(deltaSandbox.dir);
      expect(summary).toMatchObject({ strictProofReproofStatus: "complete" });
      expect(summary.strictProofReproofRecoveredSourceFiles).toBeGreaterThan(0);
      expect(readGraphSnapshot(deltaSandbox.dir)).toEqual(
        readGraphSnapshot(fullSandbox.dir),
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] matches full init when a new caller follows a prior target rename",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const target = 'export function evalP3Target() { return "target"; }\n';
      const caller =
        'import { evalP3Target } from "../core/target-moved.js";\nexport function evalP3CallerE() { return evalP3Target(); }\n';
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/core/target.ts": target,
      };
      await deltaSandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(deltaSandbox, "commit A: target baseline");
      const deltaScope = `delta-rename-reproof-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);

      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.rm(path.join(deltaSandbox.dir, "src/core/target.ts"));
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/core/target-moved.ts"),
        target,
        "utf8",
      );
      await commitAll(deltaSandbox, "commit B: rename target");
      expect(
        (await docuviaApi.analyze(deltaScope, createNoopLogger())).kind,
      ).toBe(AnalyzeResultKind.AUTO_DELTA);

      const knowledgeLock = path.join(
        deltaSandbox.dir,
        ".git/docuvia-knowledge.lock",
      );
      await fs.writeFile(knowledgeLock, "");
      await fs.mkdir(path.join(deltaSandbox.dir, "src/users"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/users/caller-e.ts"),
        caller,
        "utf8",
      );
      await commitAll(deltaSandbox, "commit C: add caller");
      const analyzeLog = path.join(
        deltaSandbox.dir,
        ".docuvia/logs/analyze.log",
      );
      const priorLogLength = (await fs.readFile(analyzeLog, "utf8")).length;
      const backgroundAnalyze = deltaSandbox.runDistCli(["analyze"], {
        reject: false,
      });
      let analyzeStarted = false;
      for (let attempt = 0; attempt < 200 && !analyzeStarted; attempt += 1) {
        const appended = (await fs.readFile(analyzeLog, "utf8")).slice(
          priorLogLength,
        );
        analyzeStarted = appended.includes('"event":"analyze.delta.start"');
        if (!analyzeStarted)
          await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(analyzeStarted).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fs.rm(knowledgeLock);
      expect((await backgroundAnalyze).exitCode).toBe(0);
      await docuviaApi.analyze(deltaScope, createNoopLogger());

      const fullFiles = {
        ".gitignore": ".docuvia/\n",
        "src/core/target-moved.ts": target,
        "src/users/caller-e.ts": caller,
      };
      await fullSandbox.setup({ initGit: true, files: fullFiles });
      await commitAll(fullSandbox, "commit C: full-init reference");
      const fullScope = `full-rename-reproof-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);

      expect(readGraphSnapshot(deltaSandbox.dir)).toEqual(
        readGraphSnapshot(fullSandbox.dir),
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[stress] keeps parity across many consecutive delta commits without accumulating proof rows",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const target = 'export function stressTarget() { return "target"; }\n';
      const callerSource = (index: number) =>
        `import { stressTarget } from "../core/target.js";\nexport function stressCaller${index}() { return stressTarget(); }\n`;
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/core/target.ts": target,
      };
      await deltaSandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(deltaSandbox, "baseline");
      const deltaScope = `delta-stress-reproof-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);

      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.mkdir(path.join(deltaSandbox.dir, "src/users"), {
        recursive: true,
      });
      const commits = 6;
      const callerFiles: Record<string, string> = {};
      for (let index = 0; index < commits; index += 1) {
        const file = `src/users/caller-${index}.ts`;
        callerFiles[file] = callerSource(index);
        await fs.writeFile(
          path.join(deltaSandbox.dir, file),
          callerFiles[file],
          "utf8",
        );
        await commitAll(deltaSandbox, `add caller ${index}`);
        expect(
          (await docuviaApi.analyze(deltaScope, createNoopLogger())).kind,
        ).toBe(AnalyzeResultKind.AUTO_DELTA);
        expect(
          (await latestDeltaSummary(deltaSandbox.dir)).strictProofReproofStatus,
        ).toBe("complete");
      }

      await fullSandbox.setup({
        initGit: true,
        files: { ...baselineFiles, ...callerFiles },
      });
      await commitAll(fullSandbox, "full-init reference");
      const fullScope = `full-stress-reproof-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);

      const delta = readGraphSnapshot(deltaSandbox.dir);
      expect(delta.provenRows.map((row) => row.caller_node_key).sort()).toEqual(
        Array.from(
          { length: commits },
          (_, index) => `src/users/caller-${index}.ts#stressCaller${index}`,
        ),
      );
      expect(delta).toEqual(readGraphSnapshot(fullSandbox.dir));
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[error-handling] falls back when the HEAD source inventory is unavailable",
    async () => {
      const sandbox = instantiate(TestSandbox, []);
      sandboxes.push(sandbox);
      const initialFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function target() { return "before"; }\n',
        "src/caller.ts":
          'import { target } from "./target.js";\nexport function caller() { return target(); }\n',
      };
      await sandbox.setup({ initGit: true, files: initialFiles });
      await commitAll(sandbox, "commit A: inventory fallback baseline");
      const scopeId = `delta-inventory-fallback-${Date.now()}`;
      scopes.push(scopeId);
      await initializeAtCurrentCommit(sandbox, scopeId);

      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.writeFile(
        path.join(sandbox.dir, "src/target.ts"),
        'export function target() { return "after"; }\n',
        "utf8",
      );
      await commitAll(sandbox, "commit B: change target");

      const inventoryFailure = new DocuviaError(
        ErrorCodes.GIT_COMMAND_FAILED,
        "tracked source inventory unavailable",
      );
      const inventorySpy = vi
        .spyOn(GitLocalProvider.prototype, "listTrackedFilesWithBlobHash")
        .mockRejectedValue(inventoryFailure);

      const result = await docuviaApi.analyze(scopeId, createNoopLogger());

      expect(result.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
      expect(inventorySpy).toHaveBeenCalledTimes(1);
      expect(await latestDeltaSummary(sandbox.dir)).toMatchObject({
        strictProofReproofStatus: "scope-resolver-fallback",
        strictProofReproofFallbackReason:
          "head-source-file-inventory-unavailable",
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] keeps git blob hashes when dirty worktree blocks source-index repair",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const targetAtA = 'export function target() { return "A"; }\n';
      const targetAtB = 'export function target() { return "B"; }\n';
      const dirtyAtA = "export function dirty() { return 1; }\n";
      const initialFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": targetAtA,
        "src/dirty.ts": dirtyAtA,
        "notes.md": "baseline\n",
      };
      await deltaSandbox.setup({ initGit: true, files: initialFiles });
      await commitAll(deltaSandbox, "commit A: dirty fallback baseline");
      const deltaScope = `delta-dirty-blob-hash-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);

      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/target.ts"),
        targetAtB,
        "utf8",
      );
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/dirty.ts"),
        "export function dirty() { return 2; }\n",
        "utf8",
      );
      await commitPaths(deltaSandbox, "commit B: change target", [
        "src/target.ts",
      ]);

      const inventorySpy = vi.spyOn(
        GitLocalProvider.prototype,
        "listTrackedFilesWithBlobHash",
      );
      const deltaResult = await docuviaApi.analyze(
        deltaScope,
        createNoopLogger(),
      );
      expect(deltaResult.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
      expect(inventorySpy).toHaveBeenCalledTimes(1);
      expect(await latestDeltaSummary(deltaSandbox.dir)).toMatchObject({
        strictProofReproofStatus: "scope-resolver-fallback",
        strictProofReproofFallbackReason:
          "working-tree-has-uncommitted-changes",
      });

      await fullSandbox.setup({
        initGit: true,
        files: { ...initialFiles, "src/target.ts": targetAtB },
      });
      await commitAll(fullSandbox, "commit B: full-init reference");
      const fullScope = `full-dirty-blob-hash-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);
      const deltaTargetHash = readProjectFileHashes(deltaSandbox.dir).get(
        "src/target.ts",
      );
      const fullTargetHash = readProjectFileHashes(fullSandbox.dir).get(
        "src/target.ts",
      );
      expect(deltaTargetHash).toBe(
        (
          await deltaSandbox.runGit(["rev-parse", "HEAD:src/target.ts"])
        ).stdout.trim(),
      );
      expect(deltaTargetHash).toBe(fullTargetHash);

      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/dirty.ts"),
        dirtyAtA,
        "utf8",
      );
      inventorySpy.mockClear();
      await fs.writeFile(
        path.join(deltaSandbox.dir, "notes.md"),
        "recovery commit\n",
        "utf8",
      );
      await commitPaths(deltaSandbox, "commit C: recover source index", [
        "notes.md",
      ]);
      const recoveryResult = await docuviaApi.analyze(
        deltaScope,
        createNoopLogger(),
      );
      expect(recoveryResult.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
      expect(inventorySpy).toHaveBeenCalledTimes(1);

      await fs.writeFile(
        path.join(deltaSandbox.dir, "notes.md"),
        "steady state\n",
        "utf8",
      );
      await commitPaths(deltaSandbox, "commit D: verify stable hashes", [
        "notes.md",
      ]);
      const stableResult = await docuviaApi.analyze(
        deltaScope,
        createNoopLogger(),
      );
      expect(stableResult.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
      expect(await latestDeltaSummary(deltaSandbox.dir)).toMatchObject({
        filesReparsed: 0,
        strictProofReproofRecoveredSourceFiles: 0,
        strictProofReproofStatus: "complete",
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] keeps combined default and named import calls in delta/full parity",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const target = [
        "export default function DefaultThing() {}",
        "export function named() {}",
      ].join("\n");
      const caller = [
        'import DefaultThing, { named } from "./x.js";',
        "export function caller() {",
        "  DefaultThing();",
        "  named();",
        "}",
      ].join("\n");
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/x.ts": target,
        "src/caller.ts": caller,
      };
      await deltaSandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(deltaSandbox, "commit A: combined import baseline");
      const deltaScope = `delta-combined-import-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);

      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.writeFile(
        path.join(deltaSandbox.dir, "src/caller.ts"),
        `// changed caller\n${caller}`,
        "utf8",
      );
      await commitAll(deltaSandbox, "commit B: reparse combined import caller");
      expect(
        (await docuviaApi.analyze(deltaScope, createNoopLogger())).kind,
      ).toBe(AnalyzeResultKind.AUTO_DELTA);

      await fullSandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(fullSandbox, "commit B: full-init reference");
      const fullScope = `full-combined-import-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);

      const deltaSnapshot = readGraphSnapshot(deltaSandbox.dir);
      const fullSnapshot = readGraphSnapshot(fullSandbox.dir);
      expect(deltaSnapshot.calls).toEqual(fullSnapshot.calls);
      expect(deltaSnapshot.calls).toContainEqual({
        source_node_key: "src/caller.ts#caller",
        target_node_key: "src/x.ts#named",
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
