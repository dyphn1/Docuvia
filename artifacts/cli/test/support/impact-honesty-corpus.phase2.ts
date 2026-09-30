import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { GraphStore } from "@workspace/schema";
import type { TestSandbox } from "./sandbox.js";
import { inferObservedTarget } from "./impact-honesty-corpus.phase1.js";
import {
  PHASE2_OVERFLOW_REASON,
  buildPhase2Evaluation,
  type Phase2Evaluation,
  type Phase2FixtureGolden,
  type Phase2KnownDefect,
  type Phase2Observation,
  type RawImpactRun,
} from "./impact-honesty-epistemic.phase2.js";

// TDD-SOURCE: issue #508 Phase 2 epistemic honesty and dynamic-boundary worst cases
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
// TDD-SOURCE: issue #393 dynamic dependency evidence
// TDD-SOURCE: issue #217 lsp-fallback provenance
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
// TDD-SOURCE: docs/gitbook/guidelines/phase-based-test-quality-hardening.md

export const PHASE2_ROOT = "src/p2";

function lines(...body: string[]): string {
  return [...body, ""].join("\n");
}

function templateLoader(fnName: string, suffix = ""): string {
  return lines(
    `export async function ${fnName}(n: string): Promise<unknown> {`,
    `  return import(\`./plugins/\${n}${suffix}\`);`,
    "}",
  );
}

function emptyFunction(fnName: string): string {
  return lines(
    `export function ${fnName}(): string {`,
    `  return "${fnName}";`,
    "}",
  );
}

function staticUser(fnName: string, target: string, specifier: string): string {
  return lines(
    `import { ${target} } from "${specifier}";`,
    "",
    `export function ${fnName}(): string {`,
    `  return ${target}();`,
    "}",
  );
}

export function pluginIndex(index: number): string {
  return String(index).padStart(2, "0");
}

/** `<dir>/plugins/pNN.ts` exporting `<prefix>PNN`, for the 64/65-candidate families. */
function pluginFamily(
  dir: string,
  symbolPrefix: string,
  count: number,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (let index = 0; index < count; index++) {
    files[`${dir}/plugins/p${pluginIndex(index)}.ts`] = emptyFunction(
      `${symbolPrefix}P${pluginIndex(index)}`,
    );
  }
  return files;
}

export function pluginFamilyPaths(dir: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${dir}/plugins/p${pluginIndex(index)}.ts`,
  );
}

const A = `${PHASE2_ROOT}`;

/** Sandbox A: mutually non-interfering prefixes (E1a, E1b, E2, E3, E4a, E4b, E6, E7, E8, E9). */
export const PHASE2_SANDBOX_A_FILES: Record<string, string> = {
  // E1a bounded-single (template)
  [`${A}/single/loader.ts`]: templateLoader("evalP2SingleLoad"),
  [`${A}/single/plugins/only.ts`]: emptyFunction("evalP2SingleOnly"),

  // E1b bounded-single (literal)
  [`${A}/single-literal/loader.ts`]: lines(
    "export async function evalP2LiteralLoad(): Promise<unknown> {",
    '  return import("./plugins/only");',
    "}",
  ),
  [`${A}/single-literal/plugins/only.ts`]: emptyFunction("evalP2LiteralOnly"),

  // E2 bounded-multi + static caller + prefix/non-source decoys
  [`${A}/multi/loader.ts`]: templateLoader("evalP2MultiLoad"),
  [`${A}/multi/plugins/alpha.ts`]: emptyFunction("evalP2MultiAlpha"),
  [`${A}/multi/plugins/beta.ts`]: emptyFunction("evalP2MultiBeta"),
  [`${A}/multi/plugins/gamma.ts`]: emptyFunction("evalP2MultiGamma"),
  [`${A}/multi/direct-user.ts`]: staticUser(
    "evalP2MultiDirectUse",
    "evalP2MultiAlpha",
    "./plugins/alpha",
  ),
  [`${A}/multi/sibling.ts`]: emptyFunction("evalP2MultiSibling"),
  [`${A}/multi/plugins-extra/delta.ts`]: emptyFunction("evalP2MultiDelta"),
  [`${A}/multi/plugins/README.md`]: lines(
    "# Multi plugins",
    "",
    "Non-source decoy: never a runtime import candidate.",
  ),

  // E3 boundary-64
  [`${A}/b64/loader.ts`]: templateLoader("evalP2B64Load"),
  ...pluginFamily(`${A}/b64`, "evalP2B64", 64),

  // E4a/E4b overflow-65 (+ static caller of P00)
  [`${A}/o65/loader.ts`]: templateLoader("evalP2O65Load"),
  ...pluginFamily(`${A}/o65`, "evalP2O65", 65),
  [`${A}/o65/direct-user.ts`]: staticUser(
    "evalP2O65DirectUse",
    "evalP2O65P00",
    "./plugins/p00",
  ),

  // E6 unresolved receiver recovered by name (lsp-fallback)
  [`${A}/recv/target.ts`]: emptyFunction("evalP2RecvTarget"),
  [`${A}/recv/untyped-caller.ts`]: lines(
    "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
    "export function evalP2RecvCall(svc: any): unknown {",
    "  return svc.evalP2RecvTarget();",
    "}",
  ),

  // E7 computed member call
  [`${A}/recv/computed-target.ts`]: emptyFunction("evalP2ComputedTarget"),
  [`${A}/recv/computed-caller.ts`]: lines(
    "export function evalP2ComputedCall(svc: Record<string, () => void>): void {",
    '  return svc["evalP2ComputedTarget"]();',
    "}",
  ),

  // E8 static control (exact calibration)
  [`${A}/ctrl/target.ts`]: emptyFunction("evalP2StaticTarget"),
  [`${A}/ctrl/user.ts`]: staticUser(
    "evalP2StaticUse",
    "evalP2StaticTarget",
    "./target",
  ),

  // E9 NodeNext `.js` specifier + static caller
  [`${A}/nn/loader.ts`]: templateLoader("evalP2NnLoad", ".js"),
  [`${A}/nn/plugins/one.ts`]: emptyFunction("evalP2NnOne"),
  [`${A}/nn/direct-user.ts`]: staticUser(
    "evalP2NnDirectUse",
    "evalP2NnOne",
    "./plugins/one",
  ),
};

/** Sandbox B: an unbounded `import(x)` is target-agnostic, so it is isolated from A. */
export const PHASE2_SANDBOX_B_FILES: Record<string, string> = {
  [`${A}/unb/loader.ts`]: lines(
    "export async function evalP2UnbLoad(m: string): Promise<unknown> {",
    "  return import(m);",
    "}",
  ),
  [`${A}/unb/target.ts`]: emptyFunction("evalP2UnbTarget"),
  [`${A}/unb/target2.ts`]: emptyFunction("evalP2UnbTarget2"),
  [`${A}/unb/direct-user.ts`]: staticUser(
    "evalP2UnbDirectUse",
    "evalP2UnbTarget2",
    "./target2",
  ),
};

/** Sandbox C baseline (C0); degradation steps add files on top of it. */
export const PHASE2_SANDBOX_C_FILES: Record<string, string> = {
  [`${A}/deg/loader.ts`]: templateLoader("evalP2DegLoad"),
  [`${A}/deg/plugins/alpha.ts`]: emptyFunction("evalP2DegAlpha"),
  [`${A}/deg/plugins/beta.ts`]: emptyFunction("evalP2DegBeta"),
  [`${A}/deg/direct-user.ts`]: staticUser(
    "evalP2DegDirectUse",
    "evalP2DegAlpha",
    "./plugins/alpha",
  ),
  [`${A}/deg64/loader.ts`]: templateLoader("evalP2Deg64Load"),
  ...pluginFamily(`${A}/deg64`, "evalP2Deg64", 64),
  [`${A}/deg64/direct-user.ts`]: staticUser(
    "evalP2Deg64DirectUse",
    "evalP2Deg64P00",
    "./plugins/p00",
  ),
};

/** C1a: a new candidate (and its caller) join `deg/plugins/` without touching the loader. */
export const PHASE2_C1A_FILES: Record<string, string> = {
  [`${A}/deg/plugins/gamma.ts`]: emptyFunction("evalP2DegGamma"),
  [`${A}/deg/gamma-user.ts`]: staticUser(
    "evalP2DegGammaUse",
    "evalP2DegGamma",
    "./plugins/gamma",
  ),
};

/** C1b: the 65th candidate joins `deg64/plugins/`, crossing the bounded limit. */
export const PHASE2_C1B_FILES: Record<string, string> = {
  [`${A}/deg64/plugins/p64.ts`]: emptyFunction("evalP2Deg64P64"),
  [`${A}/deg64/p64-user.ts`]: staticUser(
    "evalP2Deg64P64Use",
    "evalP2Deg64P64",
    "./plugins/p64",
  ),
};

export const PHASE2_OUTPUT_FORMATS = {
  JSON: "json",
  HUMAN: "human",
} as const;
export type Phase2OutputFormat =
  (typeof PHASE2_OUTPUT_FORMATS)[keyof typeof PHASE2_OUTPUT_FORMATS];

export function parseImpactJson(
  stdout: string,
): Pick<RawImpactRun, "json" | "parseError"> {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (parsed === null) return { json: null, parseError: false };
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { json: null, parseError: true };
    }
    return { json: parsed as Record<string, unknown>, parseError: false };
  } catch {
    return { json: null, parseError: true };
  }
}

/** Real `docuvia impact` subprocess; never throws. Human mode leaves `json` null. */
export async function runImpactRaw(
  sandbox: TestSandbox,
  target: string,
  format: Phase2OutputFormat = PHASE2_OUTPUT_FORMATS.JSON,
): Promise<RawImpactRun> {
  const isJson = format === PHASE2_OUTPUT_FORMATS.JSON;
  const args = isJson
    ? ["impact", target, "--format=json"]
    : ["impact", target];
  const run = await sandbox.runCli(args, { reject: false });
  const exitCode = run.exitCode ?? 1;
  const stdout = String(run.stdout ?? "");
  const stderr = String(run.stderr ?? "");
  const parsed =
    isJson && exitCode === 0
      ? parseImpactJson(stdout)
      : { json: null, parseError: false };
  return { exitCode, stdout, stderr, ...parsed };
}

export function sandboxDbPath(sandbox: TestSandbox): string {
  return join(sandbox.dir, ".docuvia/local.db");
}

/** Fixed Tier B stamp: coverage state only, never dependency evidence (contract §3.3). */
export const PHASE2_TIER_B_PROCESSED_AT = "2026-01-01 00:00:00";

/**
 * Contract §3.3: seeds complete Tier B coverage through the same typed repo write a successful
 * Tier B batch performs, so partial coverage never masks a dynamic-evidence cause.
 */
export async function seedCompleteTierBCoverage(
  sandbox: TestSandbox,
): Promise<void> {
  const head = (await sandbox.runGit(["rev-parse", "HEAD"])).stdout.trim();
  const store = await GraphStore.open({
    dbPath: sandboxDbPath(sandbox),
    readonly: false,
  });
  try {
    const projectId = store.projects.getFirst()?.id;
    if (projectId === undefined) {
      throw new Error("Phase 2 coverage seeding: no project row");
    }
    for (const { filePath } of store.files.getAllHashes()) {
      store.files.markTierBProcessed({
        projectId,
        filePath,
        commitSha: head,
        processedAt: PHASE2_TIER_B_PROCESSED_AT,
      });
    }
  } finally {
    await store.close();
  }
}

/** The single persisted production artifact of #393 evidence (`docuvia_meta`). */
export const PHASE2_DYNAMIC_EVIDENCE_META_PREFIX =
  "impact.dynamic-dependencies.v1";

async function withWritableMeta<T>(
  sandbox: TestSandbox,
  action: (
    store: Awaited<ReturnType<typeof GraphStore.open>>,
    key: string,
  ) => T,
): Promise<T> {
  const store = await GraphStore.open({
    dbPath: sandboxDbPath(sandbox),
    readonly: false,
  });
  try {
    const projectId = store.projects.getFirst()?.id;
    if (projectId === undefined) {
      throw new Error("Phase 2 evidence corruption: no project row");
    }
    return action(store, `${PHASE2_DYNAMIC_EVIDENCE_META_PREFIX}:${projectId}`);
  } finally {
    await store.close();
  }
}

/** Contract §3.4 (C2): replaces the evidence row; returns the original value for restore. */
export function corruptDynamicEvidence(
  sandbox: TestSandbox,
  value: string,
): Promise<string | undefined> {
  return withWritableMeta(sandbox, (store, key) => {
    const original = store.meta.get(key);
    store.meta.set(key, value);
    return original;
  });
}

export function restoreDynamicEvidence(
  sandbox: TestSandbox,
  original: string | undefined,
): Promise<void> {
  return withWritableMeta(sandbox, (store, key) => {
    if (original === undefined) {
      throw new Error("Phase 2 evidence restore: no original value captured");
    }
    store.meta.set(key, original);
  });
}

// ─── Goldens (contract §2.2): intended behavior, never current output ─────────────────────────

/** Test-side mirror of the evidence-unavailable reasons the product must report (D1/D5). */
export const PHASE2_UNAVAILABLE_REASONS = {
  CORRUPT_JSON: "corrupt-json",
  NOT_ARRAY: "not-array",
  INVALID_RECORD: "invalid-record",
  MISSING: "missing",
} as const;

const BOUNDED_PATTERN = "bounded-local-pattern";
const LITERAL_IMPORT = "literal-dynamic-import";
const UNBOUNDED = "unbounded-runtime-expression";

const P = PHASE2_ROOT;
const B64_PATHS = pluginFamilyPaths(`${P}/b64`, 64);
const DEG64_PATHS = pluginFamilyPaths(`${P}/deg64`, 64);

export const PHASE2_O65_FIRST_64_PATHS = pluginFamilyPaths(`${P}/o65`, 64);

const OVERFLOW_O65 = {
  sourceFile: `${P}/o65/loader.ts`,
  status: "unresolved",
  reason: PHASE2_OVERFLOW_REASON,
  candidatePaths: [],
} as const;

const OVERFLOW_DEG64 = { ...OVERFLOW_O65, sourceFile: `${P}/deg64/loader.ts` };

const DEG_BOUNDED_C0 = {
  sourceFile: `${P}/deg/loader.ts`,
  status: "bounded",
  reason: BOUNDED_PATTERN,
  candidatePaths: [`${P}/deg/plugins/alpha.ts`, `${P}/deg/plugins/beta.ts`],
} as const;

const DEG_BOUNDED_C1A = {
  ...DEG_BOUNDED_C0,
  candidatePaths: [
    ...DEG_BOUNDED_C0.candidatePaths,
    `${P}/deg/plugins/gamma.ts`,
  ],
} as const;

/** Sandbox A + B fixtures (E1a-E9). */
export const PHASE2_GOLDEN_AB: readonly Phase2FixtureGolden[] = [
  {
    id: "E1a",
    sandbox: "A",
    target: "evalP2SingleOnly",
    targetFile: `${P}/single/plugins/only.ts`,
    intents: ["candidate-boundary", "epistemic-unknown"],
    expectedConfirmedFiles: [],
    expectedCandidateFiles: [`${P}/single/loader.ts`],
    expectedEvidence: [
      {
        sourceFile: `${P}/single/loader.ts`,
        status: "bounded",
        reason: BOUNDED_PATTERN,
        candidatePaths: [`${P}/single/plugins/only.ts`],
      },
    ],
  },
  {
    id: "E1b",
    sandbox: "A",
    target: "evalP2LiteralOnly",
    targetFile: `${P}/single-literal/plugins/only.ts`,
    intents: ["candidate-boundary", "epistemic-unknown"],
    expectedConfirmedFiles: [],
    expectedCandidateFiles: [`${P}/single-literal/loader.ts`],
    expectedEvidence: [
      {
        sourceFile: `${P}/single-literal/loader.ts`,
        status: "bounded",
        reason: LITERAL_IMPORT,
        candidatePaths: [`${P}/single-literal/plugins/only.ts`],
      },
    ],
  },
  {
    id: "E2",
    sandbox: "A",
    target: "evalP2MultiAlpha",
    targetFile: `${P}/multi/plugins/alpha.ts`,
    intents: ["confirmed-positive", "candidate-boundary", "epistemic-unknown"],
    expectedConfirmedFiles: [`${P}/multi/direct-user.ts`],
    expectedCandidateFiles: [`${P}/multi/loader.ts`],
    expectedPredictions: [
      { file: `${P}/multi/direct-user.ts`, channel: "static" },
      { file: `${P}/multi/loader.ts`, channel: "dynamic-candidate" },
    ],
    expectedEvidence: [
      {
        sourceFile: `${P}/multi/loader.ts`,
        status: "bounded",
        reason: BOUNDED_PATTERN,
        candidatePaths: [
          `${P}/multi/plugins/alpha.ts`,
          `${P}/multi/plugins/beta.ts`,
          `${P}/multi/plugins/gamma.ts`,
        ],
      },
    ],
    humanParity: true,
  },
  {
    id: "E3",
    sandbox: "A",
    target: "evalP2B64P63",
    targetFile: `${P}/b64/plugins/p63.ts`,
    intents: ["candidate-boundary", "epistemic-unknown"],
    expectedConfirmedFiles: [],
    expectedCandidateFiles: [`${P}/b64/loader.ts`],
    expectedPredictions: [
      { file: `${P}/b64/loader.ts`, channel: "dynamic-candidate" },
    ],
    expectedEvidence: [
      {
        sourceFile: `${P}/b64/loader.ts`,
        status: "bounded",
        reason: BOUNDED_PATTERN,
        candidatePaths: B64_PATHS,
      },
    ],
    overflowExpectation: "bounded-max",
  },
  {
    id: "E4a",
    sandbox: "A",
    target: "evalP2O65P64",
    targetFile: `${P}/o65/plugins/p64.ts`,
    intents: ["epistemic-unknown"],
    expectedConfirmedFiles: [],
    expectedCandidateFiles: [],
    expectedEvidence: [OVERFLOW_O65],
    overflowExpectation: "overflow",
    humanParity: true,
  },
  {
    id: "E4b",
    sandbox: "A",
    target: "evalP2O65P00",
    targetFile: `${P}/o65/plugins/p00.ts`,
    intents: ["confirmed-positive", "epistemic-unknown"],
    expectedConfirmedFiles: [`${P}/o65/direct-user.ts`],
    expectedCandidateFiles: [],
    expectedEvidence: [OVERFLOW_O65],
    overflowExpectation: "overflow",
  },
  {
    id: "E5a",
    sandbox: "B",
    target: "evalP2UnbTarget",
    targetFile: `${P}/unb/target.ts`,
    intents: ["epistemic-unknown"],
    expectedConfirmedFiles: [],
    expectedCandidateFiles: [],
    expectedEvidence: [
      {
        sourceFile: `${P}/unb/loader.ts`,
        status: "unresolved",
        reason: UNBOUNDED,
        candidatePaths: [],
      },
    ],
  },
  {
    id: "E5b",
    sandbox: "B",
    target: "evalP2UnbTarget2",
    targetFile: `${P}/unb/target2.ts`,
    intents: ["confirmed-positive", "epistemic-unknown"],
    expectedConfirmedFiles: [`${P}/unb/direct-user.ts`],
    expectedCandidateFiles: [],
    expectedEvidence: [
      {
        sourceFile: `${P}/unb/loader.ts`,
        status: "unresolved",
        reason: UNBOUNDED,
        candidatePaths: [],
      },
    ],
  },
  {
    id: "E6",
    sandbox: "A",
    target: "evalP2RecvTarget",
    targetFile: `${P}/recv/target.ts`,
    intents: ["confirmed-positive"],
    expectedConfirmedFiles: [`${P}/recv/untyped-caller.ts`],
    expectedCandidateFiles: [],
    expectedPredictions: [
      { file: `${P}/recv/untyped-caller.ts`, channel: "lsp-fallback" },
    ],
    expectedEvidence: [],
    humanParity: true,
  },
  {
    id: "E7",
    sandbox: "A",
    target: "evalP2ComputedTarget",
    targetFile: `${P}/recv/computed-target.ts`,
    intents: ["epistemic-unknown"],
    expectedConfirmedFiles: [],
    expectedCandidateFiles: [],
    optionalPredictions: [
      { file: `${P}/recv/computed-caller.ts`, channel: "lsp-fallback" },
    ],
    expectedEvidence: [],
  },
  {
    id: "E8",
    sandbox: "A",
    target: "evalP2StaticTarget",
    targetFile: `${P}/ctrl/target.ts`,
    intents: ["confirmed-positive"],
    expectedConfirmedFiles: [`${P}/ctrl/user.ts`],
    expectedCandidateFiles: [],
    expectedPredictions: [{ file: `${P}/ctrl/user.ts`, channel: "static" }],
    expectedEvidence: [],
    calibration: true,
    humanParity: true,
  },
  {
    id: "E9",
    sandbox: "A",
    target: "evalP2NnOne",
    targetFile: `${P}/nn/plugins/one.ts`,
    intents: ["confirmed-positive", "epistemic-unknown"],
    expectedConfirmedFiles: [`${P}/nn/direct-user.ts`],
    expectedCandidateFiles: [`${P}/nn/loader.ts`],
    expectedEvidence: [
      {
        sourceFile: `${P}/nn/loader.ts`,
        status: "bounded",
        reason: BOUNDED_PATTERN,
        candidatePaths: [`${P}/nn/plugins/one.ts`],
      },
    ],
  },
];

const DEG_ALPHA_BASE = {
  sandbox: "C",
  target: "evalP2DegAlpha",
  targetFile: `${P}/deg/plugins/alpha.ts`,
  intents: ["confirmed-positive", "epistemic-unknown"],
  expectedConfirmedFiles: [`${P}/deg/direct-user.ts`],
  degradation: true,
} as const;

const DEG64_P00_BASE = {
  sandbox: "C",
  target: "evalP2Deg64P00",
  targetFile: `${P}/deg64/plugins/p00.ts`,
  intents: ["confirmed-positive", "epistemic-unknown"],
  expectedConfirmedFiles: [`${P}/deg64/direct-user.ts`],
  degradation: true,
} as const;

function unavailableGolden(
  id: string,
  reason: string,
  humanParity = false,
): Phase2FixtureGolden {
  return {
    ...DEG_ALPHA_BASE,
    id,
    expectedCandidateFiles: [],
    expectedEvidence: [],
    expectedUnavailableReason: reason,
    ...(humanParity ? { humanParity } : {}),
  };
}

/** Sandbox C stages, in execution order (contract §3.4). */
export const PHASE2_GOLDEN_C = {
  C0: [
    {
      ...DEG_ALPHA_BASE,
      id: "C0-alpha",
      expectedCandidateFiles: [`${P}/deg/loader.ts`],
      expectedEvidence: [DEG_BOUNDED_C0],
    },
    {
      ...DEG64_P00_BASE,
      id: "C0-deg64",
      expectedCandidateFiles: [`${P}/deg64/loader.ts`],
      expectedEvidence: [
        {
          sourceFile: `${P}/deg64/loader.ts`,
          status: "bounded",
          reason: BOUNDED_PATTERN,
          candidatePaths: DEG64_PATHS,
        },
      ],
      overflowExpectation: "bounded-max",
    },
  ],
  C2a: [
    unavailableGolden("C2a", PHASE2_UNAVAILABLE_REASONS.CORRUPT_JSON, true),
  ],
  C2b: [unavailableGolden("C2b", PHASE2_UNAVAILABLE_REASONS.NOT_ARRAY)],
  C2c: [unavailableGolden("C2c", PHASE2_UNAVAILABLE_REASONS.INVALID_RECORD)],
  C1a: [
    {
      sandbox: "C",
      id: "C1a",
      target: "evalP2DegGamma",
      targetFile: `${P}/deg/plugins/gamma.ts`,
      intents: ["confirmed-positive", "epistemic-unknown"],
      expectedConfirmedFiles: [`${P}/deg/gamma-user.ts`],
      expectedCandidateFiles: [`${P}/deg/loader.ts`],
      expectedEvidence: [DEG_BOUNDED_C1A],
      degradation: true,
    },
  ],
  C1b: [
    {
      ...DEG64_P00_BASE,
      id: "C1b-p00",
      expectedCandidateFiles: [],
      expectedEvidence: [OVERFLOW_DEG64],
      overflowExpectation: "overflow",
    },
    {
      ...DEG64_P00_BASE,
      id: "C1b-p64",
      target: "evalP2Deg64P64",
      targetFile: `${P}/deg64/plugins/p64.ts`,
      expectedConfirmedFiles: [`${P}/deg64/p64-user.ts`],
      expectedCandidateFiles: [],
      expectedEvidence: [OVERFLOW_DEG64],
      overflowExpectation: "overflow",
    },
  ],
  C3: [
    {
      ...DEG_ALPHA_BASE,
      id: "C3",
      expectedCandidateFiles: [`${P}/deg/loader.ts`],
      expectedEvidence: [DEG_BOUNDED_C1A],
      humanParity: true,
    },
  ],
} as const satisfies Record<string, readonly Phase2FixtureGolden[]>;

/** Byte payloads for the C2 corrupted-artifact variants (contract §3.4). */
export const PHASE2_CORRUPTIONS = {
  C2a: "{not-json",
  C2b: "{}",
  C2c: JSON.stringify([
    {
      sourceFile: `${P}/deg/loader.ts`,
      kind: "dynamic-import",
      expression: "x",
      startLine: 0,
      startColumn: 0,
      status: "bounded",
      reason: "x",
    },
  ]),
} as const;

export const PHASE2_GOLDEN: readonly Phase2FixtureGolden[] = [
  ...PHASE2_GOLDEN_AB,
  ...Object.values(PHASE2_GOLDEN_C).flat(),
];

/**
 * Plan §5.4 deferred-defect registry: fixture id -> product defect + child issue. The golden
 * expectation of a registered fixture is never altered; the integration test asserts the gate
 * still fails for exactly these fixtures, so a product fix forces the entry's removal.
 */
export const KNOWN_PRODUCT_DEFECTS: Readonly<
  Record<string, Phase2KnownDefect>
> = {};

// ─── Observation (real CLI + snapshotted database facts) ──────────────────────────────────────

interface NodePathRow {
  readonly path_patterns: string | null;
}

function parsePathPatterns(raw: string | null): string[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

/** Same `l2_nodes.path_patterns` lookup as Phase 1's `dependencyPredictions`. */
export function entryFilesFor(
  db: Database.Database,
  names: readonly string[],
): Record<string, string[]> {
  const statement = db.prepare(
    "SELECT path_patterns FROM l2_nodes WHERE name = ?",
  );
  const result: Record<string, string[]> = {};
  for (const name of names) {
    const rows = statement.all(name) as NodePathRow[];
    result[name] = [
      ...new Set(rows.flatMap((row) => parsePathPatterns(row.path_patterns))),
    ].sort();
  }
  return result;
}

function blastRadiusNames(run: RawImpactRun): string[] {
  const entries = run.json?.blastRadius;
  return Array.isArray(entries)
    ? entries.map((entry) => String((entry as { name: unknown }).name))
    : [];
}

export interface Phase2ObserveOptions {
  /** Also run human mode for `humanParity` fixtures (contract §3.5). */
  readonly human?: boolean;
}

export async function observePhase2Fixture(
  sandbox: TestSandbox,
  golden: Phase2FixtureGolden,
  options: Phase2ObserveOptions = {},
): Promise<Phase2Observation> {
  const run = await runImpactRaw(sandbox, golden.target);
  const human =
    options.human && golden.humanParity
      ? await runImpactRaw(sandbox, golden.target, PHASE2_OUTPUT_FORMATS.HUMAN)
      : undefined;

  const dbPath = sandboxDbPath(sandbox);
  if (run.json === null || !existsSync(dbPath)) {
    return {
      fixtureId: golden.id,
      run,
      ...(human ? { human } : {}),
      targetIdentity: null,
      entryFiles: {},
    };
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    let targetIdentity: Phase2Observation["targetIdentity"] = null;
    try {
      targetIdentity = inferObservedTarget(
        db,
        golden.target,
        run.json as unknown as Parameters<typeof inferObservedTarget>[2],
      );
    } catch {
      targetIdentity = null;
    }
    return {
      fixtureId: golden.id,
      run,
      ...(human ? { human } : {}),
      targetIdentity,
      entryFiles: entryFilesFor(db, blastRadiusNames(run)),
    };
  } finally {
    db.close();
  }
}

export interface Phase2StageResult {
  readonly observations: Phase2Observation[];
  readonly evaluation: Phase2Evaluation;
}

/** Sequentially observes `goldens` against one sandbox state and scores them. */
export async function evaluatePhase2Stage(
  sandbox: TestSandbox,
  goldens: readonly Phase2FixtureGolden[],
  options: Phase2ObserveOptions = {},
): Promise<Phase2StageResult> {
  const observations: Phase2Observation[] = [];
  for (const golden of goldens) {
    observations.push(await observePhase2Fixture(sandbox, golden, options));
  }
  return {
    observations,
    evaluation: buildPhase2Evaluation(goldens, observations),
  };
}

/** Raw JSON stdout per fixture, for the byte-identical determinism check (G10). */
export function rawJsonStdout(
  observations: readonly Phase2Observation[],
): Record<string, string> {
  return Object.fromEntries(
    observations.map((observation) => [
      observation.fixtureId,
      observation.run.stdout,
    ]),
  );
}

/** Sets up a committed, `init`-ed sandbox with complete Tier B coverage (contract §3.3). */
export async function setupPhase2Sandbox(
  sandbox: TestSandbox,
  files: Record<string, string>,
): Promise<void> {
  await sandbox.setup({ initGit: true, files });
  await sandbox.runGit(["add", "-A"]);
  await sandbox.runGit(["commit", "-m", "impact-honesty-phase2-corpus"]);
  const init = await sandbox.runCli(["init"], { reject: false });
  if (init.exitCode !== 0) {
    throw new Error(`Phase 2 sandbox init failed: ${String(init.stderr)}`);
  }
  await seedCompleteTierBCoverage(sandbox);
}

/** Commits `files` and runs a real incremental `analyze`, then re-seeds coverage (C1a/C1b). */
export async function addFilesAndAnalyze(
  sandbox: TestSandbox,
  files: Record<string, string>,
  writeFile: (path: string, content: string) => Promise<void>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(join(sandbox.dir, relativePath), content);
  }
  await sandbox.runGit(["add", "-A"]);
  await sandbox.runGit(["commit", "-m", "impact-honesty-phase2-degradation"]);
  const analyze = await sandbox.runCli(["analyze"], { reject: false });
  if (analyze.exitCode !== 0) {
    throw new Error(`Phase 2 analyze failed: ${String(analyze.stderr)}`);
  }
  await seedCompleteTierBCoverage(sandbox);
}
