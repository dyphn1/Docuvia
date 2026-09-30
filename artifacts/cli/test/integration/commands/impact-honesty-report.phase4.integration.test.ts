import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import {
  buildDistCli,
  type DistCliBuild,
  TestSandbox,
} from "../../support/sandbox.js";
import { CORPUS_FILES, GOLDEN_CASES } from "../../support/impact-corpus.js";
import {
  IMPACT_EVAL_MIN_MEAN_F1,
  aggregateCases,
} from "../../support/impact-eval-scorer.js";
import {
  PHASE1_CORPUS_FILES,
  PHASE1_GOLDEN_CASES,
  assertPhase1ImpactHonestyGates,
  evaluateLegacyImpactCorpus,
  evaluatePhase1ImpactHonesty,
} from "../../support/impact-honesty-corpus.phase1.js";
import {
  KNOWN_PRODUCT_DEFECTS,
  PHASE2_C1A_FILES,
  PHASE2_C1B_FILES,
  PHASE2_CORRUPTIONS,
  PHASE2_GOLDEN,
  PHASE2_GOLDEN_AB,
  PHASE2_GOLDEN_C,
  PHASE2_SANDBOX_A_FILES,
  PHASE2_SANDBOX_B_FILES,
  PHASE2_SANDBOX_C_FILES,
  addFilesAndAnalyze,
  corruptDynamicEvidence,
  evaluatePhase2Stage,
  restoreDynamicEvidence,
  setupPhase2Sandbox,
  type Phase2StageResult,
} from "../../support/impact-honesty-corpus.phase2.js";
import {
  mergePhase2Evaluations,
  partitionKnownDefects,
  phase2GateViolations,
} from "../../support/impact-honesty-epistemic.phase2.js";
import {
  PHASE3_CHECKPOINTS,
  runPhase3Corpus,
  type Phase3CorpusRun,
} from "../../support/impact-honesty-corpus.phase3.js";
import {
  PHASE3_KNOWN_PRODUCT_DEFECTS,
  partitionPhase3KnownDefects,
  phase3DeterminismViolations,
  phase3GateViolations,
  type Phase3GateViolation,
} from "../../support/impact-honesty-transition.phase3.js";
import {
  IMPACT_HONESTY_REPORT_SCHEMA_VERSION,
  PHASE4_CASE_FAMILIES,
  PHASE4_METRIC_IDS,
  PHASE4_SLICE_IDS,
  buildImpactHonestyReport,
  type ImpactHonestyReport,
  type ImpactHonestyReportInput,
  type Phase4CandidateObservation,
  type Phase4KnownDefect,
  type Phase4StateTransitionObservation,
  type Phase4UpstreamGateFailure,
} from "../../support/impact-honesty-report.phase4.js";
import { renderImpactHonestyReport } from "../../support/impact-honesty-renderer.phase4.js";
import { assertImpactHonestyReportGates } from "../../support/impact-honesty-gates.phase4.js";

// TDD-SOURCE: issue #508 Phase 4 honest CI report and hard regression gates
// TDD-SOURCE: docs/ai_plans/acceptance_508-phase4-honest-ci-report.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase4.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase{0,1,2,3}.md
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md

const RESULTS_DIR = resolve(__dirname, "../../../../../evaluate/results");
const REPORT_JSON_PATH = join(RESULTS_DIR, "impact_honesty_phase4.json");
const REPORT_MARKDOWN_PATH = join(
  RESULTS_DIR,
  "impact_honesty_phase4.summary.md",
);
const PHASE4_EVAL_ENABLED_VALUE = "true";
const PHASE4_EVAL_ENABLED =
  import.meta.env.PHASE4_EVAL === PHASE4_EVAL_ENABLED_VALUE;
const PHASE4_CORPUS_SETUP_TIMEOUT_MS = 5 * SUBPROCESS_TEST_TIMEOUT_MS;
const C_STAGE_ORDER = ["C0", "C2a", "C2b", "C2c", "C1a", "C1b", "C3"] as const;
const PHASE4_UPSTREAM_GATE_IDS = {
  PHASE1: "phase1-existing-gates",
  STALE_EDGE: "S5",
  STALE_RECORD: "S6",
} as const;

async function writeFileEnsuringDir(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function phase1GateFailure(error: unknown): Phase4UpstreamGateFailure {
  return {
    gateId: PHASE4_UPSTREAM_GATE_IDS.PHASE1,
    sliceId: PHASE4_SLICE_IDS.PHASE1,
    caseIds: PHASE1_GOLDEN_CASES.map((golden) => golden.scenario),
    detail: error instanceof Error ? error.message : String(error),
  };
}

function phase2GateFailures(
  evaluation: ReturnType<typeof mergePhase2Evaluations>,
): Phase4UpstreamGateFailure[] {
  const { gated } = partitionKnownDefects(evaluation, KNOWN_PRODUCT_DEFECTS);
  return phase2GateViolations(gated).map((failure) => ({
    gateId: failure.gate,
    sliceId: PHASE4_SLICE_IDS.PHASE2,
    caseIds: failure.fixtures,
    detail: failure.message,
  }));
}

function phase3GateFailures(run: Phase3CorpusRun): {
  failures: Phase4UpstreamGateFailure[];
  violations: Phase3GateViolation[];
} {
  const { gated } = partitionPhase3KnownDefects(
    run.evaluation,
    PHASE3_KNOWN_PRODUCT_DEFECTS,
  );
  const violations = phase3GateViolations(gated);
  return {
    failures: violations.map((failure) => ({
      gateId: failure.gate,
      sliceId: PHASE4_SLICE_IDS.PHASE3,
      caseIds: failure.checkpoints,
      detail: failure.message,
    })),
    violations: phase3GateViolations(run.evaluation),
  };
}

function phase2CandidateObservations(
  evaluation: ReturnType<typeof mergePhase2Evaluations>,
): Phase4CandidateObservation[] {
  return evaluation.fixtures.map((fixture) => ({
    caseId: fixture.golden.id,
    candidateSetSize: fixture.evidence.candidateSetSize,
    goldInCandidateSet: fixture.evidence.goldInCandidateSet,
    overflow: fixture.evidence.truncatedOrOverflow,
    unresolved: fixture.evidence.records.some(
      (record) => record.status === "unresolved",
    ),
  }));
}

function phase3CandidateObservations(
  run: Phase3CorpusRun,
): Phase4CandidateObservation[] {
  return run.evaluation.checkpoints.flatMap((checkpoint) =>
    checkpoint.targets.map((target) => ({
      caseId: checkpoint.checkpoint.id,
      candidateSetSize: target.evidence.candidateSetSize,
      goldInCandidateSet: target.evidence.goldInCandidateSet,
      overflow: target.evidence.truncatedOrOverflow,
      unresolved: target.evidence.records.some(
        (record) => record.status === "unresolved",
      ),
    })),
  );
}

function stateTransitions(
  run: Phase3CorpusRun,
  violations: readonly Phase3GateViolation[],
): Phase4StateTransitionObservation[] {
  return run.checkpoints.map((checkpoint) => {
    const checkpointViolations = violations.filter((violation) =>
      violation.checkpoints.includes(checkpoint.id),
    );
    return {
      kind: checkpoint.transition,
      passed: checkpointViolations.length === 0,
      caseIds: [checkpoint.id],
      staleEdgeViolations: checkpointViolations.filter(
        (violation) => violation.gate === PHASE4_UPSTREAM_GATE_IDS.STALE_EDGE,
      ).length,
      staleRecordViolations: checkpointViolations.filter(
        (violation) => violation.gate === PHASE4_UPSTREAM_GATE_IDS.STALE_RECORD,
      ).length,
    };
  });
}

function knownDefects(
  violations: readonly Phase3GateViolation[],
): Phase4KnownDefect[] {
  return Object.entries(PHASE3_KNOWN_PRODUCT_DEFECTS).map(
    ([checkpoint, entry]) => ({
      defect: entry.defect,
      checkpoint,
      issue: entry.issue,
      checkpointPassed: !violations.some((violation) =>
        violation.checkpoints.includes(checkpoint),
      ),
    }),
  );
}

function createReportInput(
  legacyResults: Awaited<ReturnType<typeof evaluateLegacyImpactCorpus>>,
  phase1Results: Awaited<ReturnType<typeof evaluatePhase1ImpactHonesty>>,
  phase2Evaluation: ReturnType<typeof mergePhase2Evaluations>,
  firstPhase3: Phase3CorpusRun,
  secondPhase3: Phase3CorpusRun,
): ImpactHonestyReportInput {
  const legacyAggregate = aggregateCases(legacyResults);
  const legacyRegressed =
    legacyAggregate.meanF1 === null ||
    legacyAggregate.meanF1 < IMPACT_EVAL_MIN_MEAN_F1
      ? legacyResults.map((result) => result.scenario)
      : [];
  const phase1GateFailures: Phase4UpstreamGateFailure[] = [];
  try {
    assertPhase1ImpactHonestyGates(phase1Results);
  } catch (error) {
    phase1GateFailures.push(phase1GateFailure(error));
  }
  const p2Failures = phase2GateFailures(phase2Evaluation);
  const p3 = phase3GateFailures(firstPhase3);
  const replayMismatches = phase3DeterminismViolations(
    {
      evaluation: firstPhase3.evaluation,
      observations: firstPhase3.observations,
    },
    {
      evaluation: secondPhase3.evaluation,
      observations: secondPhase3.observations,
    },
  ).flatMap((failure) => failure.checkpoints);

  return {
    schemaVersion: IMPACT_HONESTY_REPORT_SCHEMA_VERSION,
    legacy: {
      scope: "legacy #192 positive regression",
      caseFamily: PHASE4_CASE_FAMILIES.LEGACY_POSITIVE,
      declaredCaseIds: GOLDEN_CASES.map((golden) => golden.scenario),
      results: legacyResults,
      aggregate: legacyAggregate,
      missingCaseIds: [],
      regressedCaseIds: legacyRegressed,
    },
    phase1: {
      scope: "synthetic TypeScript Phase 1 negative / ambiguity",
      caseFamily: PHASE4_CASE_FAMILIES.NEGATIVE_AMBIGUITY,
      declaredCaseIds: PHASE1_GOLDEN_CASES.map((golden) => golden.scenario),
      records: phase1Results,
      upstreamGateFailures: phase1GateFailures,
      exclusions: [],
    },
    phase2: {
      scope: "synthetic TypeScript Phase 2 epistemic / dynamic-boundary",
      caseFamily: PHASE4_CASE_FAMILIES.EPISTEMIC_CANDIDATE,
      declaredCaseIds: PHASE2_GOLDEN.map((golden) => golden.id),
      records: phase2Evaluation.records,
      candidateObservations: phase2CandidateObservations(phase2Evaluation),
      upstreamGateFailures: p2Failures,
      exclusions: [],
    },
    phase3: {
      scope: "synthetic TypeScript Phase 3 state-transition",
      caseFamily: PHASE4_CASE_FAMILIES.STATE_TRANSITION,
      declaredCaseIds: PHASE3_CHECKPOINTS.map((checkpoint) => checkpoint.id),
      records: firstPhase3.evaluation.records,
      candidateObservations: phase3CandidateObservations(firstPhase3),
      stateTransitions: stateTransitions(firstPhase3, p3.violations),
      replayMismatches,
      upstreamGateFailures: p3.failures,
      exclusions: [],
    },
    knownDefects: knownDefects(p3.violations),
  };
}

// The corpus replays the legacy and Phase 1–3 CLI suites through real subprocesses. Keep it out
// of the default suite because it duplicates roughly 18 minutes of work and can exceed Windows'
// ten-minute hook budget. The dedicated eval job is the authoritative lane for these six tests.
describe.skipIf(!PHASE4_EVAL_ENABLED)(
  "Phase 4: honest CI report and hard regression gates (#508)",
  () => {
    let reportJson = "";
    let reportMarkdown = "";
    let repeatedReportJson = "";
    let repeatedReportMarkdown = "";
    let reportGates: () => void;
    let dist: DistCliBuild | undefined;
    let legacySandbox: TestSandbox | undefined;
    let legacyDb: Database.Database | undefined;
    const phase2Sandboxes: TestSandbox[] = [];

    beforeAll(async () => {
      legacySandbox = new TestSandbox();
      await legacySandbox.setup({
        initGit: true,
        files: { ...CORPUS_FILES, ...PHASE1_CORPUS_FILES },
      });
      await legacySandbox.runGit(["add", "-A"]);
      await legacySandbox.runGit([
        "commit",
        "-m",
        "impact-honesty-phase4-corpus",
      ]);
      const init = await legacySandbox.runCli(["init"], { reject: false });
      if (init.exitCode !== 0) {
        throw new Error(`Phase 4 legacy corpus init failed: ${init.stderr}`);
      }
      legacyDb = new Database(join(legacySandbox.dir, ".docuvia/local.db"), {
        readonly: true,
      });
      const legacyResults = await evaluateLegacyImpactCorpus(
        legacySandbox,
        legacyDb,
      );
      const phase1Results = await evaluatePhase1ImpactHonesty(
        legacySandbox,
        legacyDb,
      );

      const sandboxA = new TestSandbox();
      const sandboxB = new TestSandbox();
      const sandboxC = new TestSandbox();
      phase2Sandboxes.push(sandboxA, sandboxB, sandboxC);
      await setupPhase2Sandbox(sandboxA, PHASE2_SANDBOX_A_FILES);
      const phase2A = await evaluatePhase2Stage(
        sandboxA,
        PHASE2_GOLDEN_AB.filter((golden) => golden.sandbox === "A"),
        { human: true },
      );
      await setupPhase2Sandbox(sandboxB, PHASE2_SANDBOX_B_FILES);
      const phase2B = await evaluatePhase2Stage(
        sandboxB,
        PHASE2_GOLDEN_AB.filter((golden) => golden.sandbox === "B"),
        { human: true },
      );
      await setupPhase2Sandbox(sandboxC, PHASE2_SANDBOX_C_FILES);
      const phase2C = {} as Record<
        (typeof C_STAGE_ORDER)[number],
        Phase2StageResult
      >;
      const observeC = async (stage: (typeof C_STAGE_ORDER)[number]) => {
        phase2C[stage] = await evaluatePhase2Stage(
          sandboxC,
          PHASE2_GOLDEN_C[stage],
          { human: true },
        );
      };
      await observeC("C0");
      for (const stage of ["C2a", "C2b", "C2c"] as const) {
        const original = await corruptDynamicEvidence(
          sandboxC,
          PHASE2_CORRUPTIONS[stage],
        );
        await observeC(stage);
        await restoreDynamicEvidence(sandboxC, original);
      }
      await addFilesAndAnalyze(
        sandboxC,
        PHASE2_C1A_FILES,
        writeFileEnsuringDir,
      );
      await observeC("C1a");
      await addFilesAndAnalyze(
        sandboxC,
        PHASE2_C1B_FILES,
        writeFileEnsuringDir,
      );
      await observeC("C1b");
      const snapshot = await sandboxC.runCli(["snapshot"], { reject: false });
      expect(snapshot.exitCode).toBe(0);
      const clean = await sandboxC.runCli(["clean"], { reject: false });
      expect(clean.exitCode).toBe(0);
      await observeC("C3");
      const phase2Evaluation = mergePhase2Evaluations([
        phase2A.evaluation,
        phase2B.evaluation,
        ...C_STAGE_ORDER.map((stage) => phase2C[stage].evaluation),
      ]);

      dist = await buildDistCli();
      const firstPhase3 = await runPhase3Corpus(dist.cliPath);
      const secondPhase3 = await runPhase3Corpus(dist.cliPath);
      const input = createReportInput(
        legacyResults,
        phase1Results,
        phase2Evaluation,
        firstPhase3,
        secondPhase3,
      );
      const report = buildImpactHonestyReport(input);
      const rendered = renderImpactHonestyReport(report);
      const repeated = renderImpactHonestyReport(
        buildImpactHonestyReport(input),
      );
      reportJson = rendered.json;
      reportMarkdown = rendered.markdown;
      repeatedReportJson = repeated.json;
      repeatedReportMarkdown = repeated.markdown;
      reportGates = () => assertImpactHonestyReportGates(report);
      await mkdir(RESULTS_DIR, { recursive: true });
      await writeFile(REPORT_JSON_PATH, reportJson, "utf8");
      await writeFile(REPORT_MARKDOWN_PATH, reportMarkdown, "utf8");
    }, PHASE4_CORPUS_SETUP_TIMEOUT_MS);

    afterAll(async () => {
      legacyDb?.close();
      await legacySandbox?.teardown();
      for (const sandbox of phase2Sandboxes) await sandbox.teardown();
      await dist?.cleanup();
    });

    it("[happy] publishes one versioned report with all four labeled slices", () => {
      const parsed = JSON.parse(reportJson) as {
        schemaVersion: number;
        slices: Array<{ id: string; sampleCount: number }>;
      };
      expect(parsed.schemaVersion).toBe(IMPACT_HONESTY_REPORT_SCHEMA_VERSION);
      expect(parsed.slices.map((slice) => slice.id)).toEqual([
        PHASE4_SLICE_IDS.LEGACY,
        PHASE4_SLICE_IDS.PHASE1,
        PHASE4_SLICE_IDS.PHASE2,
        PHASE4_SLICE_IDS.PHASE3,
      ]);
      expect(parsed.slices.every((slice) => slice.sampleCount > 0)).toBe(true);
    });

    it("[happy] the real golden corpus passes every Phase 4 hard gate", () => {
      expect(reportGates).toBeDefined();
      expect(reportGates).not.toThrow();
    });

    it("[invalid-input] the human report lists exactly its empty metric denominators", () => {
      const report = JSON.parse(reportJson) as ImpactHonestyReport;
      const rates = [
        [
          PHASE4_METRIC_IDS.LEGACY_PRECISION,
          report.metrics.legacyPositiveRegression.precision,
        ],
        [
          PHASE4_METRIC_IDS.LEGACY_RECALL,
          report.metrics.legacyPositiveRegression.recall,
        ],
        [
          PHASE4_METRIC_IDS.CONFIRMED_PRECISION,
          report.metrics.confirmedDependencyAccuracy.precision,
        ],
        [
          PHASE4_METRIC_IDS.CONFIRMED_RECALL,
          report.metrics.confirmedDependencyAccuracy.recall,
        ],
        [
          PHASE4_METRIC_IDS.NEGATIVE_SPECIFICITY,
          report.metrics.negativeDiscrimination.specificity,
        ],
        [
          PHASE4_METRIC_IDS.NEGATIVE_FALSE_POSITIVE_RATE,
          report.metrics.negativeDiscrimination.falsePositiveRate,
        ],
        [
          PHASE4_METRIC_IDS.WRONG_TARGET_RATE,
          report.metrics.targetIdentity.wrongTargetRate,
        ],
        [
          PHASE4_METRIC_IDS.GOLD_IN_CANDIDATE_SET,
          report.metrics.candidateBoundary.goldInCandidateSet,
        ],
        [
          PHASE4_METRIC_IDS.CORRECT_UNKNOWN_RATE,
          report.metrics.epistemicHonesty.correctUnknownRate,
        ],
        [
          PHASE4_METRIC_IDS.FALSE_SAFE_RATE,
          report.metrics.epistemicHonesty.falseSafeRate,
        ],
        [
          PHASE4_METRIC_IDS.PROVENANCE_MISMATCH_RATE,
          report.metrics.epistemicHonesty.provenanceMismatchRate,
        ],
      ] as const;
      const expectedNaMetrics = rates
        .filter(([, metric]) => metric.denominator === 0)
        .map(([metric]) => metric)
        .sort();
      expect(report.naMetrics.map((metric) => metric.metric).sort()).toEqual(
        expectedNaMetrics,
      );
      expect(expectedNaMetrics).toEqual([]);
      expect(reportMarkdown).not.toContain("NaN");
      expect(reportMarkdown).not.toMatch(/overall|blended/i);
    });

    it("[error-handling] errors, exclusions and known defects stay visible", () => {
      expect(reportMarkdown).toContain("## Errors, N/A and exclusions");
      expect(reportMarkdown).toContain("## Known product defects");
      expect(reportMarkdown).toContain("D12");
      expect(reportMarkdown).toContain("#521");
    });

    it("[stress] renders deterministic JSON and Markdown for identical input", () => {
      expect(repeatedReportJson).toBe(reportJson);
      expect(repeatedReportMarkdown).toBe(reportMarkdown);
      expect(reportMarkdown).toContain("## What these metrics do NOT prove");
    });

    it("[state-diff] includes transition pass/fail and stale-record columns", () => {
      expect(reportMarkdown).toContain(
        "transition kind | pass | fail | stale-edge | stale-record",
      );
      expect(reportMarkdown).toContain("Deterministic replay mismatches:");
    });
  },
);
