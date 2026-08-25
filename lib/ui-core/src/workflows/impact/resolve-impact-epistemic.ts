import {
  EpistemicLevels,
  GitConstants,
  RiskLevels,
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
  /** Number of incoming-edge dependents `ImpactService.getBlastRadius` resolved. */
  blastRadiusCount: number;
  /** Risk band already derived from `blastRadiusCount` by `IImpactService.computeRiskLevel` --
   *  passed through unchanged unless the result is empty (then overridden to UNKNOWN). */
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
}

export interface ImpactEpistemicResult {
  /** Final risk band: UNKNOWN whenever the blast radius is empty (never a false-safe LOW),
   *  otherwise `computedRiskLevel` verbatim. */
  riskLevel: RiskLevel;
  /** Omitted entirely when `EXACT` (omit-when-confident convention). */
  epistemic?: EpistemicLevel;
  /** Human-readable reason attached whenever `epistemic` is lower-bound; omitted with it. */
  riskNote?: string;
}

/** Note selection for an empty blast radius (first match wins): partial Tier B coverage >
 *  registry-mediated dependents > issue #221 P2''s low own-file resolution > the structural
 *  static-edges-only caveat. The low-resolution rung deliberately sits *below* the two
 *  pre-existing rungs so no previously-shipped note wording changes (existing outputs are
 *  byte-stable); it only sharpens the generic fallback for targets whose own file's ingestion
 *  left most call sites unresolved. Split out of `resolveImpactEpistemic` to keep both under
 *  the ESLint complexity budget. */
function pickEmptyRiskNote(
  workspaceFilesProcessed: number | undefined,
  workspaceFilesTotal: number | undefined,
  registryMediated: boolean,
  targetFileResolution: TargetFileResolution | undefined,
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
 * Issue #192: translates raw impact output + coverage signals into an honest epistemic verdict,
 * split out of `ImpactWorkflow.execute()` as pure logic so the decision table is directly
 * unit-testable without a store mock (mirrors `computeRiskLevelFromCounts`'s precedent).
 *
 * Decision ladder (first match wins):
 * - Empty blast radius -> risk UNKNOWN, always lower-bound (see `pickEmptyRiskNote` for which
 *   why-note applies).
 * - Non-empty but partial workspace Tier B coverage -> keep the earned risk band, flag
 *   lower-bound so a partially-populated graph can't read as complete.
 * - Otherwise exact: all fields omitted.
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
