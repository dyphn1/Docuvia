import type Database from "better-sqlite3";
import type { TestSandbox } from "./sandbox.js";
import { GOLDEN_CASES } from "./impact-corpus.js";
import {
  errorCase,
  scoreCase,
  type ImpactEvalCaseResult,
} from "./impact-eval-scorer.js";
import {
  IMPACT_HONESTY_SCHEMA_VERSION,
  aggregateImpactHonesty,
  scoreImpactHonestyCase,
  type ImpactHonestyAggregate,
  type ImpactHonestyCaseIntent,
  type ImpactHonestyCaseResult,
  type ImpactHonestyEvidenceChannel,
  type ImpactHonestyPrediction,
} from "./impact-eval-honesty.js";

// TDD-SOURCE: issue #508 Phase 1 negative + ambiguity adversarial corpus
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase1.md

export const PHASE1_CORPUS_FILES: Record<string, string> = {
  // N1: a real, uniquely named target with no dependents.
  "src/adversarial/unused.ts": [
    "export function evalUnusedTarget(): string {",
    '  return "unused";',
    "}",
    "",
  ].join("\n"),

  // N2: exact same class name in two files. The non-test canonical definition has no
  // dependents; only the spec-file decoy is extended. A wrong target choice therefore
  // creates both a wrong-target result and a dependency false positive.
  "src/adversarial/same-name-canonical.ts": [
    "export class EvalSameNameLure {}",
    "",
  ].join("\n"),
  "src/adversarial/same-name-lure.spec.ts": [
    "export class EvalSameNameLure {}",
    "",
  ].join("\n"),
  "src/adversarial/same-name-lure-child.ts": [
    'import { EvalSameNameLure } from "./same-name-lure.spec";',
    "",
    "export class EvalSameNameLureChild extends EvalSameNameLure {}",
    "",
  ].join("\n"),

  // N3: duplicate exact function names in non-test modules. The canonical definition has
  // two real callers while the decoy has one, exercising the documented connectivity
  // tiebreak without making the benchmark infer identity from the resolver's SQL.
  "src/adversarial/duplicate-canonical.ts": [
    "export function evalDuplicateTarget(): string {",
    '  return "canonical";',
    "}",
    "",
  ].join("\n"),
  "src/adversarial/duplicate-decoy.ts": [
    "export function evalDuplicateTarget(): string {",
    '  return "decoy";',
    "}",
    "",
  ].join("\n"),
  "src/adversarial/duplicate-canonical-user-a.ts": [
    'import { evalDuplicateTarget } from "./duplicate-canonical";',
    "",
    "export function runDuplicateCanonicalA(): string {",
    "  return evalDuplicateTarget();",
    "}",
    "",
  ].join("\n"),
  "src/adversarial/duplicate-canonical-user-b.ts": [
    'import { evalDuplicateTarget } from "./duplicate-canonical";',
    "",
    "export function runDuplicateCanonicalB(): string {",
    "  return evalDuplicateTarget();",
    "}",
    "",
  ].join("\n"),
  "src/adversarial/duplicate-decoy-user.ts": [
    'import { evalDuplicateTarget } from "./duplicate-decoy";',
    "",
    "export function runDuplicateDecoy(): string {",
    "  return evalDuplicateTarget();",
    "}",
    "",
  ].join("\n"),

  // N4: an exact name must beat a much more connected substring/LIKE candidate.
  "src/adversarial/exact-priority.ts": [
    "export function evalExactPriority(): string {",
    '  return "exact";',
    "}",
    "",
  ].join("\n"),
  "src/adversarial/exact-priority-helper.ts": [
    "export function evalExactPriorityHelper(): string {",
    '  return "helper";',
    "}",
    "",
  ].join("\n"),
  "src/adversarial/exact-helper-user-a.ts": [
    'import { evalExactPriorityHelper } from "./exact-priority-helper";',
    "",
    "export function runExactHelperA(): string {",
    "  return evalExactPriorityHelper();",
    "}",
    "",
  ].join("\n"),
  "src/adversarial/exact-helper-user-b.ts": [
    'import { evalExactPriorityHelper } from "./exact-priority-helper";',
    "",
    "export function runExactHelperB(): string {",
    "  return evalExactPriorityHelper();",
    "}",
    "",
  ].join("\n"),

  // N5: similar path/module/symbol names are noise, not dependents.
  "src/adversarial/near-match-target.ts": [
    "export function evalNearMatchTarget(): string {",
    '  return "target";',
    "}",
    "",
  ].join("\n"),
  "src/adversarial/evalNearMatchTarget-neighbor.ts": [
    "export function evalNearMatchTargetNeighbor(): string {",
    '  return "neighbor";',
    "}",
    "",
  ].join("\n"),
  "src/adversarial/near-match-neighbor-user.ts": [
    'import { evalNearMatchTargetNeighbor } from "./evalNearMatchTarget-neighbor";',
    "",
    "export function runNearMatchNeighbor(): string {",
    "  return evalNearMatchTargetNeighbor();",
    "}",
    "",
  ].join("\n"),

  // N6: a positive target and unrelated decoy live in the same fixture.
  "src/adversarial/positive-target.ts": [
    "export function evalPositiveTarget(): string {",
    '  return "positive";',
    "}",
    "",
  ].join("\n"),
  "src/adversarial/positive-user.ts": [
    'import { evalPositiveTarget } from "./positive-target";',
    "",
    "export function runPositiveTarget(): string {",
    "  return evalPositiveTarget();",
    "}",
    "",
  ].join("\n"),
  "src/adversarial/positive-target-decoy.ts": [
    "export function evalPositiveTargetDecoy(): string {",
    '  return "decoy";',
    "}",
    "",
  ].join("\n"),
  "src/adversarial/positive-decoy-user.ts": [
    'import { evalPositiveTargetDecoy } from "./positive-target-decoy";',
    "",
    "export function runPositiveDecoy(): string {",
    "  return evalPositiveTargetDecoy();",
    "}",
    "",
  ].join("\n"),
};

export interface Phase1GoldenCase {
  readonly scenario:
    | "zero-dependents"
    | "same-name-lure"
    | "duplicate-symbol-resolution"
    | "exact-over-like"
    | "near-match-noise"
    | "positive-with-decoy";
  readonly target: string;
  readonly intent: Extract<
    ImpactHonestyCaseIntent,
    "negative" | "confirmed-positive"
  >;
  readonly expectedConfirmedFiles: readonly string[];
  readonly expectedTargetIdentity?: string;
}

export const PHASE1_GOLDEN_CASES: readonly Phase1GoldenCase[] = [
  {
    scenario: "zero-dependents",
    target: "evalUnusedTarget",
    intent: "negative",
    expectedConfirmedFiles: [],
    expectedTargetIdentity: "src/adversarial/unused.ts#evalUnusedTarget",
  },
  {
    scenario: "same-name-lure",
    target: "EvalSameNameLure",
    intent: "negative",
    expectedConfirmedFiles: [],
    expectedTargetIdentity:
      "src/adversarial/same-name-canonical.ts#EvalSameNameLure",
  },
  {
    scenario: "duplicate-symbol-resolution",
    target: "evalDuplicateTarget",
    intent: "confirmed-positive",
    expectedConfirmedFiles: [
      "src/adversarial/duplicate-canonical-user-a.ts",
      "src/adversarial/duplicate-canonical-user-b.ts",
    ],
    expectedTargetIdentity:
      "src/adversarial/duplicate-canonical.ts#evalDuplicateTarget",
  },
  {
    scenario: "exact-over-like",
    target: "evalExactPriority",
    intent: "negative",
    expectedConfirmedFiles: [],
    expectedTargetIdentity:
      "src/adversarial/exact-priority.ts#evalExactPriority",
  },
  {
    scenario: "near-match-noise",
    target: "evalNearMatchTarget",
    intent: "negative",
    expectedConfirmedFiles: [],
    expectedTargetIdentity:
      "src/adversarial/near-match-target.ts#evalNearMatchTarget",
  },
  {
    scenario: "positive-with-decoy",
    target: "evalPositiveTarget",
    intent: "confirmed-positive",
    expectedConfirmedFiles: ["src/adversarial/positive-user.ts"],
    expectedTargetIdentity:
      "src/adversarial/positive-target.ts#evalPositiveTarget",
  },
];

interface ImpactJsonEntry {
  readonly name: string;
  readonly edgeSource?: string;
}

interface ImpactJsonResult {
  readonly blastRadius: readonly ImpactJsonEntry[];
}

interface NodeIdentityRow {
  readonly name: string;
  readonly node_key: string | null;
  readonly path_patterns: string | null;
}

interface NodePathRow {
  readonly path_patterns: string | null;
}

function parsePathPatterns(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function nodePathsByName(db: Database.Database, name: string): string[] {
  const rows = db
    .prepare("SELECT path_patterns FROM l2_nodes WHERE name = ?")
    .all(name) as NodePathRow[];
  return [...new Set(rows.flatMap((row) => parsePathPatterns(row.path_patterns)))].sort();
}

function inferObservedTarget(
  db: Database.Database,
  target: string,
  impact: ImpactJsonResult,
): { identity: string; filePath: string } {
  const rows = db
    .prepare(
      "SELECT name, node_key, path_patterns FROM l2_nodes WHERE name = ? ORDER BY node_key ASC",
    )
    .all(target) as NodeIdentityRow[];
  const blastNames = new Set(impact.blastRadius.map((entry) => entry.name));

  const matched = rows
    .map((row) => ({
      identity: row.node_key,
      filePath: parsePathPatterns(row.path_patterns)[0],
    }))
    .filter(
      (
        candidate,
      ): candidate is { identity: string; filePath: string } =>
        candidate.identity !== null &&
        candidate.filePath !== undefined &&
        blastNames.has(candidate.filePath),
    );

  if (matched.length !== 1) {
    throw new Error(
      `impact honesty target identity: expected one selected node for '${target}', found ${matched.length}`,
    );
  }
  return matched[0];
}

function mapEvidenceChannel(edgeSource: string | undefined): ImpactHonestyEvidenceChannel {
  if (edgeSource === undefined) return "static";
  if (
    edgeSource === "lsp-fallback" ||
    edgeSource === "dynamic-candidate"
  ) {
    return edgeSource;
  }
  throw new Error(`unknown impact edgeSource: ${edgeSource}`);
}

function dependencyPredictions(
  db: Database.Database,
  impact: ImpactJsonResult,
  targetFilePath: string,
): ImpactHonestyPrediction[] {
  const predictions: ImpactHonestyPrediction[] = [];
  for (const entry of impact.blastRadius) {
    for (const file of nodePathsByName(db, entry.name)) {
      if (file === targetFilePath) continue;
      predictions.push({
        file,
        channel: mapEvidenceChannel(entry.edgeSource),
      });
    }
  }
  return predictions;
}

async function runImpact(
  sandbox: TestSandbox,
  target: string,
): Promise<{ status: "resolved" | "not-found" | "error"; impact: ImpactJsonResult | null }> {
  try {
    const run = await sandbox.runCli(["impact", target, "--format=json"], {
      reject: false,
    });
    if (run.exitCode !== 0) return { status: "error", impact: null };
    const parsed = JSON.parse(run.stdout.trim()) as ImpactJsonResult | null;
    return parsed === null
      ? { status: "not-found", impact: null }
      : { status: "resolved", impact: parsed };
  } catch {
    return { status: "error", impact: null };
  }
}

export async function evaluatePhase1ImpactHonesty(
  sandbox: TestSandbox,
  db: Database.Database,
): Promise<ImpactHonestyCaseResult[]> {
  const results: ImpactHonestyCaseResult[] = [];

  for (const golden of PHASE1_GOLDEN_CASES) {
    const run = await runImpact(sandbox, golden.target);
    if (run.status !== "resolved" || run.impact === null) {
      results.push(
        scoreImpactHonestyCase({
          schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
          scenario: golden.scenario,
          target: golden.target,
          expectedTargetIdentity: golden.expectedTargetIdentity,
          intent: golden.intent,
          expectedStatus: "resolved",
          expectedConfirmedFiles: golden.expectedConfirmedFiles,
          expectedCandidateFiles: [],
          observedStatus: run.status,
          predictions: [],
        }),
      );
      continue;
    }

    try {
      const selected = inferObservedTarget(db, golden.target, run.impact);
      results.push(
        scoreImpactHonestyCase({
          schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
          scenario: golden.scenario,
          target: golden.target,
          expectedTargetIdentity: golden.expectedTargetIdentity,
          observedTargetIdentity: selected.identity,
          intent: golden.intent,
          expectedStatus: "resolved",
          expectedConfirmedFiles: golden.expectedConfirmedFiles,
          expectedCandidateFiles: [],
          observedStatus: "resolved",
          predictions: dependencyPredictions(
            db,
            run.impact,
            selected.filePath,
          ),
        }),
      );
    } catch {
      results.push(
        scoreImpactHonestyCase({
          schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
          scenario: golden.scenario,
          target: golden.target,
          expectedTargetIdentity: golden.expectedTargetIdentity,
          intent: golden.intent,
          expectedStatus: "resolved",
          expectedConfirmedFiles: golden.expectedConfirmedFiles,
          expectedCandidateFiles: [],
          observedStatus: "error",
          predictions: [],
        }),
      );
    }
  }

  return results;
}

function legacyDependentFiles(
  db: Database.Database,
  target: string,
  impact: ImpactJsonResult | null,
): string[] {
  if (!impact) return [];
  const targetFiles = new Set(nodePathsByName(db, target));
  const predicted = new Set<string>();
  for (const entry of impact.blastRadius) {
    for (const file of nodePathsByName(db, entry.name)) {
      if (!targetFiles.has(file)) predicted.add(file);
    }
  }
  return [...predicted].sort();
}

export async function evaluateLegacyImpactCorpus(
  sandbox: TestSandbox,
  db: Database.Database,
): Promise<ImpactEvalCaseResult[]> {
  const results: ImpactEvalCaseResult[] = [];
  for (const golden of GOLDEN_CASES) {
    const run = await runImpact(sandbox, golden.target);
    if (run.status === "error") {
      results.push(
        errorCase(
          golden.scenario,
          golden.target,
          golden.expectedDependentFiles,
        ),
      );
      continue;
    }
    results.push(
      scoreCase(
        golden.scenario,
        golden.target,
        legacyDependentFiles(db, golden.target, run.impact),
        golden.expectedDependentFiles,
      ),
    );
  }
  return results;
}

export function assertPhase1ImpactHonestyGates(
  results: readonly ImpactHonestyCaseResult[],
): ImpactHonestyAggregate {
  const aggregate = aggregateImpactHonesty(results);

  if (aggregate.errorCases > 0) {
    throw new Error(
      `Phase 1 impact honesty gate: ${aggregate.errorCases} case(s) errored`,
    );
  }
  const wrongStatuses = results.filter((result) => !result.statusCorrect);
  if (wrongStatuses.length > 0) {
    throw new Error(
      `Phase 1 impact honesty gate: unexpected status in ${wrongStatuses
        .map((result) => result.scenario)
        .join(", ")}`,
    );
  }
  if (aggregate.negative.specificity !== 1) {
    throw new Error(
      `Phase 1 impact honesty gate: negative specificity ${String(
        aggregate.negative.specificity,
      )} is not 1`,
    );
  }
  if (aggregate.negative.falsePositiveRate !== 0) {
    throw new Error(
      `Phase 1 impact honesty gate: false-positive rate ${String(
        aggregate.negative.falsePositiveRate,
      )} is not 0`,
    );
  }
  if (aggregate.targetResolution.wrongTargetRate !== 0) {
    throw new Error(
      `Phase 1 impact honesty gate: wrong-target rate ${String(
        aggregate.targetResolution.wrongTargetRate,
      )} is not 0`,
    );
  }

  const badPositive = results.find(
    (result) =>
      result.intent === "confirmed-positive" &&
      (result.positive?.precision !== 1 ||
        result.positive.recall !== 1 ||
        result.positive.f1 !== 1),
  );
  if (badPositive) {
    throw new Error(
      `Phase 1 impact honesty gate: positive case ${badPositive.scenario} is not perfect`,
    );
  }

  return aggregate;
}

function rescore(
  result: ImpactHonestyCaseResult,
  overrides: {
    predictions?: readonly ImpactHonestyPrediction[];
    observedTargetIdentity?: string;
  },
): ImpactHonestyCaseResult {
  return scoreImpactHonestyCase({
    schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
    scenario: result.scenario,
    target: result.target,
    expectedTargetIdentity: result.expectedTargetIdentity,
    observedTargetIdentity:
      overrides.observedTargetIdentity ?? result.observedTargetIdentity,
    intent: result.intent,
    expectedStatus: result.expectedStatus,
    expectedConfirmedFiles: result.expectedConfirmedFiles,
    expectedCandidateFiles: result.expectedCandidateFiles,
    expectedPredictions: result.expectedPredictions,
    observedStatus: result.observedStatus,
    predictions: overrides.predictions ?? result.predictions,
  });
}

export function poisonNegativePrediction(
  results: readonly ImpactHonestyCaseResult[],
): ImpactHonestyCaseResult[] {
  const index = results.findIndex((result) => result.intent === "negative");
  if (index < 0) throw new Error("Phase 1 poison control: no negative case");

  return results.map((result, current) =>
    current === index
      ? rescore(result, {
          predictions: [
            ...result.predictions,
            { file: "src/adversarial/__poison__.ts", channel: "static" },
          ],
        })
      : result,
  );
}

export function poisonTargetIdentity(
  results: readonly ImpactHonestyCaseResult[],
): ImpactHonestyCaseResult[] {
  const index = results.findIndex(
    (result) =>
      result.expectedTargetIdentity !== undefined &&
      result.observedStatus === "resolved",
  );
  if (index < 0) {
    throw new Error("Phase 1 poison control: no identity-checked case");
  }

  return results.map((result, current) =>
    current === index
      ? rescore(result, {
          observedTargetIdentity: "src/adversarial/__wrong__.ts#wrong",
        })
      : result,
  );
}
