import {
  EpistemicLevels,
  GitConstants,
  RiskLevels,
  type DynamicDependencyEvidence,
  type EpistemicLevel,
  type RiskLevel,
} from "@workspace/contracts";
import { IMPACT_MESSAGES } from "./impact-messages.js";

/** Issue #221 P2': the target's own file's Tier A call-site resolution counters (applicable =
 *  total minus self-discarded), `undefined` when the file has no stamped stats -- which must
 *  never silently sharpen confidence, mirroring the coverage-counts convention below. */
export interface TargetFileResolution {
  resolved: number;
  applicable: number;
}

export interface ImpactEpistemicInput {
  /** Number of confirmed incoming-edge dependents. Issue #393 dynamic candidates are deliberately
   *  excluded: a possible runtime target is not evidence that the dependency definitely occurs. */
  blastRadiusCount: number;
  /** Risk band already derived from confirmed `blastRadiusCount` -- passed through unchanged
   *  unless the confirmed result is empty (then overridden to UNKNOWN). */
  computedRiskLevel: RiskLevel;
  /** `files.getTierBCoverage()` counts; `undefined` on either side means coverage could not be
   *  read, which must never silently upgrade confidence (treated as incomplete). */
  workspaceFilesProcessed: number | undefined;
  workspaceFilesTotal: number | undefined;
  /** Issue #136 signal: the target's own file uses the docuviaFactory/TOKENS registry pattern,
   *  whose cross-package edges the static graph does not model. */
  registryMediated: boolean;
  /** Issue #221 P2' signal: see `TargetFileResolution`. Optional so existing callers keep
   *  compiling; absence degrades to the pre-existing note ladder unchanged. */
  targetFileResolution?: TargetFileResolution;
  /** Issue #393 target-relevant bounded/unresolved runtime dependency evidence. */
  dynamicEvidence?: DynamicDependencyEvidence[];
}

export interface ImpactEpistemicResult {
  /** Final risk band: UNKNOWN whenever the confirmed blast radius is empty (never false-safe LOW),
   *  otherwise `computedRiskLevel` verbatim. */
  riskLevel: RiskLevel;
  /** Omitted entirely when `EXACT` (omit-when-confident convention). */
  epistemic?: EpistemicLevel;
  /** Human-readable reason attached whenever `epistemic` is lower-bound; omitted with it. */
  riskNote?: string;
}

function dynamicRiskNote(
  dynamicEvidence: DynamicDependencyEvidence[] | undefined,
): string | undefined {
  if (!dynamicEvidence || dynamicEvidence.length === 0) return undefined;
  const sample = dynamicEvidence[0];
  return IMPACT_MESSAGES.RISK_NOTE_DYNAMIC_DEPENDENCY(
    dynamicEvidence.length,
    sample.sourceFile,
    sample.startLine + 1,
    sample.expression,
    sample.reason,
  );
}

/** Note selection for an empty confirmed blast radius (first match wins): partial Tier B coverage
 *  > registry-mediated dependents > explicit dynamic evidence > issue #221 P2''s low own-file
 *  resolution > the structural static-edges-only caveat. The new #393 rung is inserted only
 *  before the generic/low-confidence fallbacks, preserving the old higher-priority wording. */
function pickEmptyRiskNote(
  workspaceFilesProcessed: number | undefined,
  workspaceFilesTotal: number | undefined,
  registryMediated: boolean,
  targetFileResolution: TargetFileResolution | undefined,
  dynamicEvidence: DynamicDependencyEvidence[] | undefined,
): string {
  const coverageIncomplete =
    workspaceFilesProcessed === undefined ||
    workspaceFilesTotal === undefined ||
    workspaceFilesProcessed < workspaceFilesTotal;
  if (coverageIncomplete) {
    return IMPACT_MESSAGES.RISK_NOTE_EMPTY_WITH_PARTIAL_COVERAGE(
      workspaceFilesProcessed ?? 0,
      workspaceFilesTotal ?? 0,
    );
  }
  if (registryMediated) {
    return IMPACT_MESSAGES.REGISTRY_MEDIATED_COVERAGE_NOTE;
  }
  const dynamicNote = dynamicRiskNote(dynamicEvidence);
  if (dynamicNote) return dynamicNote;
  if (
    targetFileResolution &&
    targetFileResolution.applicable >=
      GitConstants.DEFAULT_CALL_RESOLUTION_MIN_SAMPLE &&
    targetFileResolution.resolved / targetFileResolution.applicable <
      GitConstants.DEFAULT_CALL_RESOLUTION_NOTE_THRESHOLD
  ) {
    return IMPACT_MESSAGES.RISK_NOTE_EMPTY_LOW_RESOLUTION(
      targetFileResolution.resolved,
      targetFileResolution.applicable,
    );
  }
  return IMPACT_MESSAGES.RISK_NOTE_EMPTY_STATIC_EDGES_ONLY;
}

/**
 * Issue #192/#393: translates confirmed impact output + coverage/evidence signals into an honest
 * epistemic verdict. Dynamic candidates never turn UNKNOWN into MEDIUM by themselves: they are
 * displayed as possible dependents but the risk band is based only on confirmed dependencies.
 *
 * Decision ladder (first match wins):
 * - Zero confirmed dependents -> risk UNKNOWN, always lower-bound.
 * - Non-empty but partial workspace Tier B coverage -> keep earned risk band, lower-bound.
 * - Non-empty with target-relevant dynamic evidence -> keep earned risk band, lower-bound.
 * - Otherwise exact: all epistemic fields omitted.
 */
export function resolveImpactEpistemic(
  input: ImpactEpistemicInput,
): ImpactEpistemicResult {
  const {
    blastRadiusCount,
    computedRiskLevel,
    workspaceFilesProcessed,
    workspaceFilesTotal,
    registryMediated,
  } = input;

  if (blastRadiusCount === 0) {
    return {
      riskLevel: RiskLevels.UNKNOWN,
      epistemic: EpistemicLevels.LOWER_BOUND,
      riskNote: pickEmptyRiskNote(
        workspaceFilesProcessed,
        workspaceFilesTotal,
        registryMediated,
        input.targetFileResolution,
        input.dynamicEvidence,
      ),
    };
  }

  const coverageIncomplete =
    workspaceFilesProcessed === undefined ||
    workspaceFilesTotal === undefined ||
    workspaceFilesProcessed < workspaceFilesTotal;
  if (coverageIncomplete) {
    return {
      riskLevel: computedRiskLevel,
      epistemic: EpistemicLevels.LOWER_BOUND,
      riskNote: IMPACT_MESSAGES.RISK_NOTE_PARTIAL_COVERAGE_NON_EMPTY(
        workspaceFilesProcessed ?? 0,
        workspaceFilesTotal ?? 0,
      ),
    };
  }

  const dynamicNote = dynamicRiskNote(input.dynamicEvidence);
  if (dynamicNote) {
    return {
      riskLevel: computedRiskLevel,
      epistemic: EpistemicLevels.LOWER_BOUND,
      riskNote: dynamicNote,
    };
  }

  return { riskLevel: computedRiskLevel };
}

/** Issue #136's standalone `coverageNote` is kept for `--format=json` back-compat, but
 *  suppressed when the epistemic ladder already picked the registry wording as `riskNote` --
 *  emitting the same sentence twice adds nothing. */
export function pickBackCompatCoverageNote(
  registryMediated: boolean,
  riskNote: string | undefined,
): string | undefined {
  if (!registryMediated) return undefined;
  return riskNote === IMPACT_MESSAGES.REGISTRY_MEDIATED_COVERAGE_NOTE
    ? undefined
    : IMPACT_MESSAGES.REGISTRY_MEDIATED_COVERAGE_NOTE;
}
