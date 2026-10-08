import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  AnalyzeResultKind,
  createNoopLogger,
  DocuviaError,
  docuviaFactory,
  docuviaMemory,
  ErrorCodes,
  MemoryKeys,
  TOKENS,
  type IAstProcessor,
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
type ResolutionRow = {
  project_id: number;
  call_site_key: string;
  identity_version: number;
  file_path: string;
  source_content_hash: string;
  start_line: number;
  start_column: number;
  callee_kind: string;
  callee_name: string;
  caller_node_key: string;
  resolution_class: string;
  selected_target_node_key: string | null;
  confidence: number | null;
  resolver: string;
  rule_signature: string;
  dependency_fingerprint: string;
  verification_status: string;
  verified_target_node_key: string | null;
  is_stale: number;
};
type ResolutionDependencyRow = {
  dependency_kind: string;
  dependency_path: string;
};
type CandidateMemberDependencyRow = { dependency_path: string };
type StoredResolutionDependencyRow = {
  call_site_key: string;
  dependency_kind: string;
  dependency_path: string;
  content_hash: string | null;
};

type GraphSnapshot = {
  provenRows: ProvenRow[];
  resolutionRows: ResolutionRow[];
  dependencies: StoredResolutionDependencyRow[];
  calls: CallEdge[];
};
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
      resolutionRows: db
        .prepare(
          `SELECT project_id, call_site_key, identity_version, file_path,
                  source_content_hash, start_line, start_column, callee_kind,
                  callee_name, caller_node_key, resolution_class,
                  selected_target_node_key, confidence, resolver, rule_signature,
                  dependency_fingerprint, verification_status,
                  verified_target_node_key, is_stale
           FROM call_site_resolutions
           WHERE resolver = 'strict-proof'
           ORDER BY call_site_key, file_path, resolver, rule_signature`,
        )
        .all() as ResolutionRow[],
      dependencies: db
        .prepare(
          `SELECT d.call_site_key, d.dependency_kind, d.dependency_path, d.content_hash
           FROM call_site_resolution_dependencies AS d
           JOIN call_site_resolutions AS r
             ON r.project_id = d.project_id AND r.call_site_key = d.call_site_key
           WHERE r.resolver = 'strict-proof'
           ORDER BY d.call_site_key, d.dependency_kind, d.dependency_path`,
        )
        .all() as StoredResolutionDependencyRow[],
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

function readResolutionDependencies(
  workspaceRoot: string,
  filePath: string,
): ResolutionDependencyRow[] {
  const db = instantiate<InstanceType<typeof Database>>(Database, [
    `${workspaceRoot}/.docuvia/local.db`,
    { readonly: true },
  ]);
  try {
    const rows = db
      .prepare(
        `SELECT d.dependency_kind, d.dependency_path
         FROM call_site_resolution_dependencies AS d
         JOIN call_site_resolutions AS r
           ON r.project_id = d.project_id AND r.call_site_key = d.call_site_key
         WHERE r.file_path = ?
         ORDER BY d.dependency_path`,
      )
      .all(filePath) as ResolutionDependencyRow[];
    return rows;
  } finally {
    db.close();
  }
}

function readCandidateMemberDependencies(
  workspaceRoot: string,
  filePath: string,
): string[] {
  const db = instantiate<InstanceType<typeof Database>>(Database, [
    `${workspaceRoot}/.docuvia/local.db`,
    { readonly: true },
  ]);
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT d.dependency_path
         FROM call_site_resolution_dependencies AS d
         JOIN call_site_resolutions AS r
           ON r.project_id = d.project_id AND r.call_site_key = d.call_site_key
         WHERE r.file_path = ? AND d.dependency_kind = 'candidate-member'
         ORDER BY d.dependency_path`,
      )
      .all(filePath) as CandidateMemberDependencyRow[];
    return rows.map(({ dependency_path }) => dependency_path);
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

function clearSourceIndexFacts(workspaceRoot: string, filePath: string): void {
  const db = instantiate<InstanceType<typeof Database>>(Database, [
    `${workspaceRoot}/.docuvia/local.db`,
  ]);
  try {
    const result = db
      .prepare(
        "UPDATE project_files SET source_index_json = NULL WHERE file_path = ?",
      )
      .run(filePath);
    expect(result.changes).toBe(1);
  } finally {
    db.close();
  }
}

function deletePersistedFileRow(workspaceRoot: string, filePath: string): void {
  const db = instantiate<InstanceType<typeof Database>>(Database, [
    `${workspaceRoot}/.docuvia/local.db`,
  ]);
  try {
    const result = db
      .prepare("DELETE FROM project_files WHERE file_path = ?")
      .run(filePath);
    expect(result.changes).toBe(1);
  } finally {
    db.close();
  }
}

function readMetaValue(workspaceRoot: string, key: string): string | undefined {
  const db = instantiate<InstanceType<typeof Database>>(Database, [
    `${workspaceRoot}/.docuvia/local.db`,
    { readonly: true },
  ]);
  try {
    return (
      db.prepare("SELECT value FROM docuvia_meta WHERE key = ?").get(key) as
        { value: string } | undefined
    )?.value;
  } finally {
    db.close();
  }
}

async function initializeAtCurrentCommit(
  sandbox: TestSandbox,
  scopeId: string,
): Promise<void> {
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, sandbox.dir);
  await docuviaApi.init(scopeId, createNoopLogger());
}

async function compareCandidateDomainChangeWithFreshInit(input: {
  readonly label: string;
  readonly baselineFiles: Record<string, string>;
  readonly finalFiles: Record<string, string>;
  readonly sandboxes: TestSandbox[];
  readonly scopes: string[];
}): Promise<{
  delta: GraphSnapshot;
  full: GraphSnapshot;
  baselineCallerDependencies: ResolutionDependencyRow[];
}> {
  const deltaSandbox = instantiate(TestSandbox, []);
  const fullSandbox = instantiate(TestSandbox, []);
  input.sandboxes.push(deltaSandbox, fullSandbox);
  await deltaSandbox.setup({ initGit: true, files: input.baselineFiles });
  await commitAll(deltaSandbox, `${input.label}: commit A`);
  const deltaScope = `delta-candidate-domain-${Date.now()}-${Math.random()}`;
  input.scopes.push(deltaScope);
  await initializeAtCurrentCommit(deltaSandbox, deltaScope);
  const baselineCallerDependencies = readResolutionDependencies(
    deltaSandbox.dir,
    "src/caller.ts",
  );

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const baselineSourcePaths = Object.keys(input.baselineFiles).filter((file) =>
    file.startsWith("src/"),
  );
  const finalSourcePaths = new Set(
    Object.keys(input.finalFiles).filter((file) => file.startsWith("src/")),
  );
  for (const file of baselineSourcePaths) {
    if (!finalSourcePaths.has(file))
      await fs.rm(path.join(deltaSandbox.dir, file), { force: true });
  }
  for (const [file, source] of Object.entries(input.finalFiles)) {
    if (!file.startsWith("src/")) continue;
    const fullPath = path.join(deltaSandbox.dir, file);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, source, "utf8");
  }
  await commitAll(deltaSandbox, `${input.label}: commit B`);
  expect((await docuviaApi.analyze(deltaScope, createNoopLogger())).kind).toBe(
    AnalyzeResultKind.AUTO_DELTA,
  );
  expect(await latestDeltaSummary(deltaSandbox.dir)).toMatchObject({
    strictProofCandidateDomainChangedMemberNames: ["greet"],
    strictProofCandidateDomainReproofAffectedCallerFiles: 1,
  });

  await fullSandbox.setup({ initGit: true, files: input.finalFiles });
  await commitAll(fullSandbox, `${input.label}: fresh full reference`);
  const fullScope = `full-candidate-domain-${Date.now()}-${Math.random()}`;
  input.scopes.push(fullScope);
  await initializeAtCurrentCommit(fullSandbox, fullScope);

  return {
    delta: readGraphSnapshot(deltaSandbox.dir),
    full: readGraphSnapshot(fullSandbox.dir),
    baselineCallerDependencies,
  };
}

async function compareMissingCandidateFactsWithFreshInit(input: {
  readonly label: string;
  readonly missingFacts: "null-source-index" | "missing-project-file-row";
  /** Defaults to a same-name competitor; `unrelated` makes the caller's import uniquely provable. */
  readonly otherFile?: "competitor" | "unrelated";
  readonly sandboxes: TestSandbox[];
  readonly scopes: string[];
}): Promise<{
  delta: GraphSnapshot;
  full: GraphSnapshot;
  summary: Record<string, unknown>;
}> {
  const baselineCaller =
    'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n';
  const baselineFiles = {
    ".gitignore": ".docuvia/\n",
    "src/target.ts": 'export function greet() { return "target"; }\n',
    "src/competitor.ts":
      input.otherFile === "unrelated"
        ? 'export function farewell() { return "unrelated"; }\n'
        : 'export function greet() { return "competitor"; }\n',
    "src/caller.ts": baselineCaller,
  };
  const finalFiles = {
    ...baselineFiles,
    "src/caller.ts": `// caller-only edit\n${baselineCaller}`,
  };
  const deltaSandbox = instantiate(TestSandbox, []);
  const fullSandbox = instantiate(TestSandbox, []);
  input.sandboxes.push(deltaSandbox, fullSandbox);
  await deltaSandbox.setup({ initGit: true, files: baselineFiles });
  await commitAll(deltaSandbox, `${input.label}: commit A`);
  const deltaScope = `delta-missing-candidate-facts-${Date.now()}-${Math.random()}`;
  input.scopes.push(deltaScope);
  await initializeAtCurrentCommit(deltaSandbox, deltaScope);

  if (input.missingFacts === "null-source-index") {
    clearSourceIndexFacts(deltaSandbox.dir, "src/competitor.ts");
  } else {
    deletePersistedFileRow(deltaSandbox.dir, "src/competitor.ts");
  }

  const fs = await import("node:fs/promises");
  await fs.writeFile(
    `${deltaSandbox.dir}/src/caller.ts`,
    finalFiles["src/caller.ts"],
    "utf8",
  );
  await commitPaths(deltaSandbox, `${input.label}: caller-only commit B`, [
    "src/caller.ts",
  ]);
  expect((await docuviaApi.analyze(deltaScope, createNoopLogger())).kind).toBe(
    AnalyzeResultKind.AUTO_DELTA,
  );

  await fullSandbox.setup({ initGit: true, files: finalFiles });
  await commitAll(fullSandbox, `${input.label}: fresh full reference`);
  const fullScope = `full-missing-candidate-facts-${Date.now()}-${Math.random()}`;
  input.scopes.push(fullScope);
  await initializeAtCurrentCommit(fullSandbox, fullScope);

  return {
    delta: readGraphSnapshot(deltaSandbox.dir),
    full: readGraphSnapshot(fullSandbox.dir),
    summary: await latestDeltaSummary(deltaSandbox.dir),
  };
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
    "[state-diff] re-proves a caller when a new file adds a competing same-name function",
    async () => {
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
      };
      const finalFiles = {
        ...baselineFiles,
        "src/other.ts": 'export function greet() { return "other"; }\n',
      };
      const { delta, full } = await compareCandidateDomainChangeWithFreshInit({
        label: "add competing same-name function",
        baselineFiles,
        finalFiles,
        sandboxes,
        scopes,
      });

      expect(
        full.provenRows.some(
          ({ caller_node_key, rule_signature }) =>
            caller_node_key === "src/caller.ts#caller" &&
            rule_signature === "q1:named-import:v1",
        ),
      ).toBe(false);
      expect(delta.resolutionRows).toEqual(full.resolutionRows);
      expect(delta.calls).toEqual(full.calls);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] re-proves a caller when an unrelated file adds a competing export",
    async () => {
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
        "src/other.ts": 'export function unrelated() { return "other"; }\n',
      };
      const finalFiles = {
        ...baselineFiles,
        "src/other.ts":
          'export function unrelated() { return "other"; }\nexport function greet() { return "competitor"; }\n',
      };
      const { delta, full } = await compareCandidateDomainChangeWithFreshInit({
        label: "modify unrelated file with competitor",
        baselineFiles,
        finalFiles,
        sandboxes,
        scopes,
      });

      expect(
        full.provenRows.some(
          ({ caller_node_key, rule_signature }) =>
            caller_node_key === "src/caller.ts#caller" &&
            rule_signature === "q1:named-import:v1",
        ),
      ).toBe(false);
      expect(delta.resolutionRows).toEqual(full.resolutionRows);
      expect(delta.calls).toEqual(full.calls);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it.each(["null-source-index", "missing-project-file-row"] as const)(
    "[state-diff] repairs an unrelated missing source fact and still proves a unique import (%s)",
    async (missingFacts) => {
      const { delta, full, summary } =
        await compareMissingCandidateFactsWithFreshInit({
          label: `missing unrelated facts ${missingFacts}`,
          missingFacts,
          otherFile: "unrelated",
          sandboxes,
          scopes,
        });

      expect(
        full.resolutionRows.filter(
          ({ file_path }) => file_path === "src/caller.ts",
        ),
      ).toMatchObject([
        {
          resolution_class: "proven",
          rule_signature: "q1:named-import:v1",
          is_stale: 0,
        },
      ]);
      expect(delta.resolutionRows).toEqual(full.resolutionRows);
      expect(delta.calls).toEqual(full.calls);
      expect(summary).toMatchObject({
        filesReparsed: 2,
        strictProofReproofStatus: "complete",
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it.each(["null-source-index", "missing-project-file-row"] as const)(
    "[state-diff] repairs a missing competitor fact before proving uniqueness (%s)",
    async (missingFacts) => {
      const { delta, full, summary } =
        await compareMissingCandidateFactsWithFreshInit({
          label: `missing competitor facts ${missingFacts}`,
          missingFacts,
          sandboxes,
          scopes,
        });

      expect(
        full.resolutionRows.filter(
          ({ file_path }) => file_path === "src/caller.ts",
        ),
      ).toMatchObject([
        {
          resolution_class: "unresolved",
          rule_signature:
            "strict-proof-candidate-domain:no-unique-owner-candidate",
          is_stale: 0,
        },
      ]);
      expect(delta.resolutionRows).toEqual(full.resolutionRows);
      expect(delta.calls).toEqual(full.calls);
      expect(summary).toMatchObject({ filesReparsed: 2 });
      expect(summary).not.toHaveProperty(
        "strictProofCandidateDomainInventoryFallback",
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] proves a previously abstained caller after a competitor is deleted",
    async () => {
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
        "src/other.ts": 'export function greet() { return "other"; }\n',
      };
      const finalFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": baselineFiles["src/target.ts"]!,
        "src/caller.ts": baselineFiles["src/caller.ts"]!,
      };
      const { delta, full, baselineCallerDependencies } =
        await compareCandidateDomainChangeWithFreshInit({
          label: "delete one competitor",
          baselineFiles,
          finalFiles,
          sandboxes,
          scopes,
        });

      expect(
        baselineCallerDependencies.map(
          ({ dependency_path }) => dependency_path,
        ),
      ).toEqual(["greet", "src/caller.ts"]);
      expect(
        full.provenRows.some(
          ({ caller_node_key, rule_signature }) =>
            caller_node_key === "src/caller.ts#caller" &&
            rule_signature === "q1:named-import:v1",
        ),
      ).toBe(true);
      expect(delta.resolutionRows).toEqual(full.resolutionRows);
      expect(delta.calls).toEqual(full.calls);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] keeps parity when a rename only moves a same-name competitor",
    async () => {
      const competitor = 'export function greet() { return "other"; }\n';
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
        "src/other.ts": competitor,
      };
      const finalFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": baselineFiles["src/target.ts"]!,
        "src/caller.ts": baselineFiles["src/caller.ts"]!,
        "src/moved.ts": competitor,
      };
      const { delta, full } = await compareCandidateDomainChangeWithFreshInit({
        label: "move competitor by rename",
        baselineFiles,
        finalFiles,
        sandboxes,
        scopes,
      });

      expect(
        full.provenRows.some(
          ({ caller_node_key, rule_signature }) =>
            caller_node_key === "src/caller.ts#caller" &&
            rule_signature === "q1:named-import:v1",
        ),
      ).toBe(false);
      expect(delta.resolutionRows).toEqual(full.resolutionRows);
      expect(delta.calls).toEqual(full.calls);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[performance] keeps a body-only edit on the precise dependency path",
    async () => {
      const sandbox = instantiate(TestSandbox, []);
      sandboxes.push(sandbox);
      await sandbox.setup({
        initGit: true,
        files: {
          ".gitignore": ".docuvia/\n",
          "src/target.ts": 'export function greet() { return "target"; }\n',
          "src/caller.ts":
            'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
          "src/other.ts": 'export function unrelated() { return "body A"; }\n',
        },
      });
      await commitAll(sandbox, "body-only baseline");
      const scope = `delta-body-only-${Date.now()}`;
      scopes.push(scope);
      await initializeAtCurrentCommit(sandbox, scope);
      const baselineSnapshot = readGraphSnapshot(sandbox.dir);

      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `${sandbox.dir}/src/other.ts`,
        'export function unrelated() { return "body B"; }\n',
        "utf8",
      );
      await commitPaths(sandbox, "body-only unrelated edit", ["src/other.ts"]);
      const result = await docuviaApi.analyze(scope, createNoopLogger());

      expect(result.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
      expect(await latestDeltaSummary(sandbox.dir)).toMatchObject({
        filesReparsed: 1,
        strictProofCandidateDomainChangedMemberNames: [],
        strictProofCandidateDomainReproofAffectedCallerFiles: 0,
      });
      expect(readGraphSnapshot(sandbox.dir)).toEqual(baselineSnapshot);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] keeps unrelated proofs while a dirty delta adds a competing candidate",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
        "src/stable.ts": 'export function stableWork() { return "stable"; }\n',
        "src/stable-caller.ts":
          'import { stableWork } from "./stable.js";\nexport function stableCaller() { return stableWork(); }\n',
      };
      const finalFiles = {
        ...baselineFiles,
        "src/other.ts": 'export function greet() { return "competitor"; }\n',
      };
      await deltaSandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(deltaSandbox, "dirty competitor baseline");
      const deltaScope = `delta-dirty-competitor-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);
      const affectedCallSiteKeys = new Set(
        readGraphSnapshot(deltaSandbox.dir)
          .resolutionRows.filter(
            ({ file_path, rule_signature }) =>
              file_path === "src/caller.ts" &&
              rule_signature === "q1:named-import:v1",
          )
          .map(({ call_site_key }) => call_site_key),
      );

      const fs = await import("node:fs/promises");
      await fs.writeFile(`${deltaSandbox.dir}/dirty-marker.txt`, "dirty\n");
      await fs.writeFile(
        `${deltaSandbox.dir}/src/other.ts`,
        finalFiles["src/other.ts"],
        "utf8",
      );
      await commitPaths(
        deltaSandbox,
        "add competitor while worktree is dirty",
        ["src/other.ts"],
      );
      const result = await docuviaApi.analyze(deltaScope, createNoopLogger());

      expect(result.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
      const summary = await latestDeltaSummary(deltaSandbox.dir);
      expect(summary).toMatchObject({
        filesReparsed: 2,
        strictProofCandidateDomainChangedMemberNames: ["greet"],
        strictProofCandidateDomainReproofAffectedCallerFiles: 1,
      });
      expect(summary).not.toHaveProperty(
        "strictProofCandidateDomainInventoryFallback",
      );

      const delta = readGraphSnapshot(deltaSandbox.dir);
      expect(
        delta.resolutionRows.some(
          ({ file_path, rule_signature, resolution_class, is_stale }) =>
            file_path === "src/caller.ts" &&
            rule_signature === "q1:named-import:v1" &&
            resolution_class === "proven" &&
            is_stale === 0,
        ),
      ).toBe(false);
      expect(
        delta.resolutionRows.filter(
          ({ file_path, resolution_class, is_stale }) =>
            file_path === "src/stable-caller.ts" &&
            resolution_class === "proven" &&
            is_stale === 0,
        ),
      ).toHaveLength(1);

      await fullSandbox.setup({ initGit: true, files: finalFiles });
      await commitAll(fullSandbox, "dirty competitor fresh full reference");
      const fullScope = `full-dirty-competitor-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);
      const full = readGraphSnapshot(fullSandbox.dir);

      const staleKeys = new Set(
        delta.resolutionRows
          .filter(({ is_stale }) => is_stale === 1)
          .map(({ call_site_key }) => call_site_key),
      );
      expect(
        delta.resolutionRows.filter(
          ({ is_stale, call_site_key }) =>
            is_stale === 0 &&
            !staleKeys.has(call_site_key) &&
            !affectedCallSiteKeys.has(call_site_key),
        ),
      ).toEqual(
        full.resolutionRows.filter(
          ({ call_site_key }) =>
            !staleKeys.has(call_site_key) &&
            !affectedCallSiteKeys.has(call_site_key),
        ),
      );
      expect(delta.calls).toEqual(full.calls);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[performance] keeps dirty body-only deltas to the changed file and recovers a missing SHA stamp precisely",
    async () => {
      const sandbox = instantiate(TestSandbox, []);
      sandboxes.push(sandbox);
      await sandbox.setup({
        initGit: true,
        files: {
          ".gitignore": ".docuvia/\n",
          "src/target.ts": 'export function greet() { return "target"; }\n',
          "src/caller.ts":
            'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
          "src/other.ts": 'export function unrelated() { return "body A"; }\n',
        },
      });
      await commitAll(sandbox, "dirty body-only baseline");
      const scope = `delta-dirty-body-only-${Date.now()}`;
      scopes.push(scope);
      await initializeAtCurrentCommit(sandbox, scope);

      const fs = await import("node:fs/promises");
      await fs.writeFile(`${sandbox.dir}/dirty-marker.txt`, "dirty\n");
      await fs.writeFile(
        `${sandbox.dir}/src/other.ts`,
        'export function unrelated() { return "body B"; }\n',
        "utf8",
      );
      await commitPaths(sandbox, "dirty body-only first edit", [
        "src/other.ts",
      ]);
      const dirtyResult = await docuviaApi.analyze(scope, createNoopLogger());
      expect(dirtyResult.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
      expect(await latestDeltaSummary(sandbox.dir)).toMatchObject({
        filesReparsed: 1,
        strictProofCandidateDomainChangedMemberNames: [],
        strictProofCandidateDomainReproofAffectedCallerFiles: 0,
      });
      expect(await latestDeltaSummary(sandbox.dir)).not.toHaveProperty(
        "strictProofCandidateDomainInventoryFallback",
      );

      await fs.rm(`${sandbox.dir}/dirty-marker.txt`);
      await fs.writeFile(
        `${sandbox.dir}/src/other.ts`,
        'export function unrelated() { return "body C"; }\n',
        "utf8",
      );
      await commitPaths(sandbox, "clean body-only after dirty delta", [
        "src/other.ts",
      ]);
      const cleanResult = await docuviaApi.analyze(scope, createNoopLogger());
      expect(cleanResult.kind).toBe(AnalyzeResultKind.AUTO_DELTA);
      const cleanSummary = await latestDeltaSummary(sandbox.dir);
      expect(cleanSummary).toMatchObject({
        filesReparsed: 1,
        strictProofCandidateDomainChangedMemberNames: [],
        strictProofCandidateDomainReproofAffectedCallerFiles: 0,
      });
      expect(cleanSummary).not.toHaveProperty(
        "strictProofCandidateDomainInventoryFallback",
      );
      expect(readMetaValue(sandbox.dir, "callResolutionSourceIndexSha")).toBe(
        await sandbox
          .runGit(["rev-parse", "HEAD"])
          .then(({ stdout }) => stdout.trim()),
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[performance] repairs persistent source-facts gaps without a full-inventory reparse",
    async () => {
      const sandbox = instantiate(TestSandbox, []);
      sandboxes.push(sandbox);
      await sandbox.setup({
        initGit: true,
        files: {
          ".gitignore": ".docuvia/\n",
          "src/target.ts": 'export function greet() { return "target"; }\n',
          "src/caller.ts":
            'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
          "src/other.ts": 'export function unrelated() { return "body A"; }\n',
          "src/partial.ts":
            'export function neverCalled() { return "partial"; }\n',
          "src/no-facts.ts":
            'export function alsoNeverCalled() { return "missing"; }\n',
        },
      });
      await commitAll(sandbox, "partial source-index baseline");
      const scope = `delta-partial-body-${Date.now()}`;
      scopes.push(scope);
      await initializeAtCurrentCommit(sandbox, scope);
      const fs = await import("node:fs/promises");
      clearSourceIndexFacts(sandbox.dir, "src/partial.ts");
      deletePersistedFileRow(sandbox.dir, "src/no-facts.ts");

      await fs.writeFile(
        `${sandbox.dir}/src/other.ts`,
        'export function unrelated() { return "body B"; }\n',
        "utf8",
      );
      await commitPaths(sandbox, "partial source-index body edit", [
        "src/other.ts",
      ]);
      expect((await docuviaApi.analyze(scope, createNoopLogger())).kind).toBe(
        AnalyzeResultKind.AUTO_DELTA,
      );

      const firstSummary = await latestDeltaSummary(sandbox.dir);
      expect(firstSummary).toMatchObject({
        filesReparsed: 3,
        strictProofCandidateDomainChangedMemberNames: [],
        strictProofCandidateDomainReproofAffectedCallerFiles: 0,
      });
      expect(firstSummary).not.toHaveProperty(
        "strictProofCandidateDomainInventoryFallback",
      );
      expect(readMetaValue(sandbox.dir, "callResolutionSourceIndexSha")).toBe(
        await sandbox
          .runGit(["rev-parse", "HEAD"])
          .then(({ stdout }) => stdout.trim()),
      );

      clearSourceIndexFacts(sandbox.dir, "src/partial.ts");
      await fs.writeFile(
        `${sandbox.dir}/src/other.ts`,
        'export function unrelated() { return "body C"; }\n',
        "utf8",
      );
      await commitPaths(sandbox, "second partial source-index body edit", [
        "src/other.ts",
      ]);
      await docuviaApi.analyze(scope, createNoopLogger());
      expect(await latestDeltaSummary(sandbox.dir)).toMatchObject({
        filesReparsed: 2,
        strictProofCandidateDomainChangedMemberNames: [],
        strictProofCandidateDomainReproofAffectedCallerFiles: 0,
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] precisely re-proves a new competitor with an unrelated missing source-facts row",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
        "src/other.ts": 'export function unrelated() { return "other"; }\n',
        "src/partial.ts":
          'export function neverCalled() { return "partial"; }\n',
      };
      const finalFiles = {
        ...baselineFiles,
        "src/other.ts":
          'export function unrelated() { return "other"; }\nexport function greet() { return "competitor"; }\n',
      };
      await deltaSandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(deltaSandbox, "partial candidate-domain baseline");
      const deltaScope = `delta-partial-competitor-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);
      clearSourceIndexFacts(deltaSandbox.dir, "src/partial.ts");

      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `${deltaSandbox.dir}/src/other.ts`,
        finalFiles["src/other.ts"],
        "utf8",
      );
      await commitPaths(deltaSandbox, "add competitor with partial facts", [
        "src/other.ts",
      ]);
      await docuviaApi.analyze(deltaScope, createNoopLogger());

      const deltaSummary = await latestDeltaSummary(deltaSandbox.dir);
      expect(deltaSummary).toMatchObject({
        filesReparsed: 3,
        strictProofCandidateDomainChangedMemberNames: ["greet"],
        strictProofCandidateDomainReproofAffectedCallerFiles: 1,
      });
      expect(deltaSummary).not.toHaveProperty(
        "strictProofCandidateDomainInventoryFallback",
      );

      await fullSandbox.setup({ initGit: true, files: finalFiles });
      await commitAll(fullSandbox, "partial facts fresh full reference");
      const fullScope = `full-partial-competitor-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);

      expect(readGraphSnapshot(deltaSandbox.dir).resolutionRows).toEqual(
        readGraphSnapshot(fullSandbox.dir).resolutionRows,
      );
      expect(readGraphSnapshot(deltaSandbox.dir).calls).toEqual(
        readGraphSnapshot(fullSandbox.dir).calls,
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[fallback] refreshes conservatively when a changed file has no old source facts",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
        "src/other.ts": 'export function unrelated() { return "other"; }\n',
      };
      const finalFiles = {
        ...baselineFiles,
        "src/other.ts":
          'export function unrelated() { return "other"; }\nexport function greet() { return "competitor"; }\n',
      };
      await deltaSandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(deltaSandbox, "changed missing-facts baseline");
      const deltaScope = `delta-changed-missing-facts-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);
      clearSourceIndexFacts(deltaSandbox.dir, "src/other.ts");

      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `${deltaSandbox.dir}/src/other.ts`,
        finalFiles["src/other.ts"],
        "utf8",
      );
      await commitPaths(deltaSandbox, "change missing-facts source", [
        "src/other.ts",
      ]);
      await docuviaApi.analyze(deltaScope, createNoopLogger());
      expect(await latestDeltaSummary(deltaSandbox.dir)).toMatchObject({
        strictProofCandidateDomainInventoryFallback: true,
      });

      await fullSandbox.setup({ initGit: true, files: finalFiles });
      await commitAll(fullSandbox, "missing-facts fresh full reference");
      const fullScope = `full-changed-missing-facts-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);
      expect(readGraphSnapshot(deltaSandbox.dir).resolutionRows).toEqual(
        readGraphSnapshot(fullSandbox.dir).resolutionRows,
      );
      expect(readGraphSnapshot(deltaSandbox.dir).calls).toEqual(
        readGraphSnapshot(fullSandbox.dir).calls,
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] records the imported export name for an aliased candidate lookup",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const caller =
        'import { greet as hi } from "./target.js";\nexport function caller() { return hi(); }\n';
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts": caller,
      };
      const finalFiles = {
        ...baselineFiles,
        "src/other.ts": 'export function greet() { return "other"; }\n',
      };
      await deltaSandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(deltaSandbox, "aliased import baseline");
      const deltaScope = `delta-aliased-import-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);
      expect(
        readCandidateMemberDependencies(deltaSandbox.dir, "src/caller.ts"),
      ).toEqual(["greet"]);

      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `${deltaSandbox.dir}/src/other.ts`,
        finalFiles["src/other.ts"],
        "utf8",
      );
      await commitPaths(deltaSandbox, "add aliased import competitor", [
        "src/other.ts",
      ]);
      expect(
        (await docuviaApi.analyze(deltaScope, createNoopLogger())).kind,
      ).toBe(AnalyzeResultKind.AUTO_DELTA);

      await fullSandbox.setup({ initGit: true, files: finalFiles });
      await commitAll(fullSandbox, "aliased import full reference");
      const fullScope = `full-aliased-import-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);

      expect(readGraphSnapshot(deltaSandbox.dir).resolutionRows).toEqual(
        readGraphSnapshot(fullSandbox.dir).resolutionRows,
      );
      expect(readGraphSnapshot(deltaSandbox.dir).calls).toEqual(
        readGraphSnapshot(fullSandbox.dir).calls,
      );
      expect(await latestDeltaSummary(deltaSandbox.dir)).toMatchObject({
        strictProofCandidateDomainChangedMemberNames: ["greet"],
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[state-diff] tracks the underlying declaration name through a reexport alias",
    async () => {
      const caller =
        'import { publicGreet as hi } from "./barrel.js";\nexport function caller() { return hi(); }\n';
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/barrel.ts":
          'export { greet as publicGreet } from "./target.js";\n',
        "src/caller.ts": caller,
      };
      const finalFiles = {
        ...baselineFiles,
        "src/other.ts": 'export function greet() { return "other"; }\n',
      };
      const { delta, full, baselineCallerDependencies } =
        await compareCandidateDomainChangeWithFreshInit({
          label: "reexport alias competitor",
          baselineFiles,
          finalFiles,
          sandboxes,
          scopes,
        });

      expect(
        baselineCallerDependencies
          .map(({ dependency_path }) => dependency_path)
          .filter(
            (_dependencyPath, index) =>
              baselineCallerDependencies[index]?.dependency_kind ===
              "candidate-member",
          ),
      ).toEqual(["greet"]);
      expect(
        full.resolutionRows.some(
          ({ file_path, resolution_class, rule_signature }) =>
            file_path === "src/caller.ts" &&
            resolution_class === "unresolved" &&
            rule_signature ===
              "strict-proof-candidate-domain:no-unique-owner-candidate",
        ),
      ).toBe(true);
      expect(delta.resolutionRows).toEqual(full.resolutionRows);
      expect(delta.calls).toEqual(full.calls);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[legacy] refreshes missing candidate dependencies once and stays precise afterward",
    async () => {
      const sandbox = instantiate(TestSandbox, []);
      sandboxes.push(sandbox);
      await sandbox.setup({
        initGit: true,
        files: {
          ".gitignore": ".docuvia/\n",
          "src/target.ts": 'export function greet() { return "target"; }\n',
          "src/caller.ts":
            'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
          "src/other.ts": 'export function unrelated() { return "body A"; }\n',
        },
      });
      await commitAll(sandbox, "legacy refresh baseline");
      const scope = `delta-legacy-refresh-${Date.now()}`;
      scopes.push(scope);
      await initializeAtCurrentCommit(sandbox, scope);

      const db = instantiate<InstanceType<typeof Database>>(Database, [
        `${sandbox.dir}/.docuvia/local.db`,
      ]);
      db.prepare(
        "DELETE FROM call_site_resolution_dependencies WHERE dependency_kind = 'candidate-member'",
      ).run();
      db.prepare("DELETE FROM docuvia_meta WHERE key = ?").run(
        "callResolutionCandidateDependencyVersion",
      );
      db.close();

      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `${sandbox.dir}/src/other.ts`,
        'export function unrelated() { return "body B"; }\n',
        "utf8",
      );
      await commitPaths(sandbox, "legacy one-time refresh", ["src/other.ts"]);
      await docuviaApi.analyze(scope, createNoopLogger());
      expect(await latestDeltaSummary(sandbox.dir)).toMatchObject({
        strictProofCandidateDomainLegacyRefresh: true,
      });
      expect(
        readCandidateMemberDependencies(sandbox.dir, "src/caller.ts"),
      ).toContain("greet");

      await fs.writeFile(
        `${sandbox.dir}/src/other.ts`,
        'export function unrelated() { return "body C"; }\n',
        "utf8",
      );
      await commitPaths(sandbox, "precise second body edit", ["src/other.ts"]);
      await docuviaApi.analyze(scope, createNoopLogger());
      expect(await latestDeltaSummary(sandbox.dir)).toMatchObject({
        filesReparsed: 1,
        strictProofCandidateDomainChangedMemberNames: [],
        strictProofCandidateDomainReproofAffectedCallerFiles: 0,
      });
      expect(await latestDeltaSummary(sandbox.dir)).not.toHaveProperty(
        "strictProofCandidateDomainLegacyRefresh",
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[legacy] retries a failed candidate-dependency refresh and matches fresh full state",
    async () => {
      const sandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(sandbox, fullSandbox);
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
        "src/other.ts": 'export function unrelated() { return "body A"; }\n',
      };
      const finalFiles = {
        ...baselineFiles,
        "src/other.ts": 'export function unrelated() { return "body C"; }\n',
      };
      await sandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(sandbox, "legacy refresh parse failure baseline");
      const scope = `delta-legacy-refresh-failure-${Date.now()}`;
      scopes.push(scope);
      await initializeAtCurrentCommit(sandbox, scope);

      const db = instantiate<InstanceType<typeof Database>>(Database, [
        `${sandbox.dir}/.docuvia/local.db`,
      ]);
      db.prepare(
        "DELETE FROM call_site_resolution_dependencies WHERE dependency_kind = 'candidate-member'",
      ).run();
      db.prepare("DELETE FROM docuvia_meta WHERE key = ?").run(
        "callResolutionCandidateDependencyVersion",
      );
      db.close();

      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `${sandbox.dir}/src/other.ts`,
        'export function unrelated() { return "body B"; }\n',
        "utf8",
      );
      await commitPaths(sandbox, "legacy refresh parse failure commit B", [
        "src/other.ts",
      ]);

      const originalResolve = docuviaFactory.resolve.bind(docuviaFactory);
      let forceTargetFailure = true;
      const resolveSpy = vi.spyOn(docuviaFactory, "resolve");
      resolveSpy.mockImplementation((token, params) => {
        const resolved = originalResolve(token, params);
        if (token !== TOKENS.AstProcessor || !forceTargetFailure)
          return resolved;
        const processor = resolved as IAstProcessor;
        return {
          processFiles: async (workspaceRoot, filesToParse) => {
            const failedFiles = filesToParse.filter(
              ({ file }) => file === "src/target.ts",
            );
            if (failedFiles.length === 0)
              return processor.processFiles(workspaceRoot, filesToParse);
            forceTargetFailure = false;
            const parsed = await processor.processFiles(
              workspaceRoot,
              filesToParse.filter(({ file }) => file !== "src/target.ts"),
            );
            return {
              parsed: parsed.parsed,
              failures: [
                ...parsed.failures,
                ...failedFiles.map(({ file, hash }) => ({
                  file,
                  hash,
                  error: "forced AST parse failure for legacy refresh",
                })),
              ],
            };
          },
        } as typeof resolved;
      });
      await docuviaApi.analyze(scope, createNoopLogger());
      resolveSpy.mockRestore();

      const firstSummary = await latestDeltaSummary(sandbox.dir);
      expect(firstSummary).toMatchObject({
        filesFailed: 1,
        strictProofReproofStatus: "scope-resolver-fallback",
        strictProofReproofFallbackReason: "candidate-domain-incomplete",
      });
      expect(
        readMetaValue(
          sandbox.dir,
          "callResolutionCandidateDependencyVersion",
        ) ?? null,
      ).toBeNull();
      expect(
        JSON.parse(
          readMetaValue(sandbox.dir, "callResolutionReproofPendingPaths") ??
            "null",
        ),
      ).toContain("src/target.ts");

      await fs.writeFile(
        `${sandbox.dir}/src/other.ts`,
        finalFiles["src/other.ts"],
        "utf8",
      );
      await commitPaths(sandbox, "legacy refresh retry commit C", [
        "src/other.ts",
      ]);
      await docuviaApi.analyze(scope, createNoopLogger());
      const secondSummary = await latestDeltaSummary(sandbox.dir);
      expect(secondSummary).toMatchObject({
        filesReparsed: 3,
        strictProofCandidateDomainLegacyRefresh: true,
        strictProofReproofStatus: "complete",
      });
      expect(
        readMetaValue(sandbox.dir, "callResolutionCandidateDependencyVersion"),
      ).toBe("1");
      expect(
        readMetaValue(sandbox.dir, "callResolutionReproofPendingPaths"),
      ).toBe("[]");

      await fullSandbox.setup({ initGit: true, files: finalFiles });
      await commitAll(fullSandbox, "legacy refresh fresh full reference");
      const fullScope = `full-legacy-refresh-failure-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);
      const delta = readGraphSnapshot(sandbox.dir);
      const full = readGraphSnapshot(fullSandbox.dir);
      expect(delta.resolutionRows).toEqual(full.resolutionRows);
      expect(delta.calls).toEqual(full.calls);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

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

  it(
    "[state-diff] stales proven candidate proofs when targeted source repair fails, then restores fresh-full parity",
    async () => {
      const deltaSandbox = instantiate(TestSandbox, []);
      const fullSandbox = instantiate(TestSandbox, []);
      sandboxes.push(deltaSandbox, fullSandbox);
      const baselineFiles = {
        ".gitignore": ".docuvia/\n",
        "src/target.ts": 'export function greet() { return "target"; }\n',
        "src/caller.ts":
          'import { greet } from "./target.js";\nexport function caller() { return greet(); }\n',
        "src/missing.ts":
          'export function unrelatedFact() { return "missing index facts"; }\n',
        "src/other.ts": 'export function other() { return "body A"; }\n',
      };
      const finalFiles = {
        ...baselineFiles,
        "src/other.ts": 'export function other() { return "body C"; }\n',
      };
      await deltaSandbox.setup({ initGit: true, files: baselineFiles });
      await commitAll(deltaSandbox, "incomplete candidate domain baseline");
      const deltaScope = `delta-incomplete-domain-${Date.now()}`;
      scopes.push(deltaScope);
      await initializeAtCurrentCommit(deltaSandbox, deltaScope);
      clearSourceIndexFacts(deltaSandbox.dir, "src/missing.ts");

      const baseline = readGraphSnapshot(deltaSandbox.dir);
      const baselineProof = baseline.resolutionRows.find(
        ({ file_path, rule_signature }) =>
          file_path === "src/caller.ts" &&
          rule_signature === "q1:named-import:v1",
      );
      if (!baselineProof?.selected_target_node_key)
        throw new Error("Baseline Q1 proof was not persisted");
      expect(baselineProof).toMatchObject({
        resolution_class: "proven",
        is_stale: 0,
      });
      const proofEdge = {
        source_node_key: baselineProof.caller_node_key,
        target_node_key: baselineProof.selected_target_node_key,
      };
      expect(baseline.calls).toContainEqual(proofEdge);

      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `${deltaSandbox.dir}/src/other.ts`,
        'export function other() { return "body B"; }\n',
        "utf8",
      );
      await commitPaths(deltaSandbox, "unrelated change with missing facts", [
        "src/other.ts",
      ]);

      const originalResolve = docuviaFactory.resolve.bind(docuviaFactory);
      let forcedRepairFailure = true;
      const resolveSpy = vi.spyOn(docuviaFactory, "resolve");
      resolveSpy.mockImplementation((token, params) => {
        const resolved = originalResolve(token, params);
        if (token !== TOKENS.AstProcessor || !forcedRepairFailure)
          return resolved;
        const processor = resolved as IAstProcessor;
        return {
          processFiles: async (workspaceRoot, filesToParse) => {
            const failedFiles = filesToParse.filter(
              ({ file }) => file === "src/missing.ts",
            );
            if (failedFiles.length === 0)
              return processor.processFiles(workspaceRoot, filesToParse);
            forcedRepairFailure = false;
            const parsed = await processor.processFiles(
              workspaceRoot,
              filesToParse.filter(({ file }) => file !== "src/missing.ts"),
            );
            return {
              parsed: parsed.parsed,
              failures: [
                ...parsed.failures,
                ...failedFiles.map(({ file, hash }) => ({
                  file,
                  hash,
                  error: "forced AST parse failure for missing source facts",
                })),
              ],
            };
          },
        } as typeof resolved;
      });
      try {
        await docuviaApi.analyze(deltaScope, createNoopLogger());
      } finally {
        resolveSpy.mockRestore();
      }

      expect(forcedRepairFailure).toBe(false);
      expect(await latestDeltaSummary(deltaSandbox.dir)).toMatchObject({
        strictProofReproofStatus: "scope-resolver-fallback",
        strictProofReproofFallbackReason: "candidate-domain-incomplete",
      });
      const incompleteSnapshot = readGraphSnapshot(deltaSandbox.dir);
      const incompleteProof = incompleteSnapshot.resolutionRows.find(
        ({ call_site_key }) => call_site_key === baselineProof.call_site_key,
      );
      expect(incompleteProof?.is_stale ?? 1).toBe(1);
      expect(incompleteSnapshot.calls).not.toContainEqual(proofEdge);

      await fs.writeFile(
        `${deltaSandbox.dir}/src/other.ts`,
        finalFiles["src/other.ts"],
        "utf8",
      );
      await commitPaths(deltaSandbox, "retry source facts on next delta", [
        "src/other.ts",
      ]);
      await docuviaApi.analyze(deltaScope, createNoopLogger());

      await fullSandbox.setup({ initGit: true, files: finalFiles });
      await commitAll(fullSandbox, "fresh full after source repair");
      const fullScope = `full-incomplete-domain-${Date.now()}`;
      scopes.push(fullScope);
      await initializeAtCurrentCommit(fullSandbox, fullScope);
      const delta = readGraphSnapshot(deltaSandbox.dir);
      const full = readGraphSnapshot(fullSandbox.dir);
      expect(delta.resolutionRows).toEqual(full.resolutionRows);
      expect(delta.calls).toEqual(full.calls);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
