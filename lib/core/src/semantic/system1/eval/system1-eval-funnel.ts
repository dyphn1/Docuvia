import { aggregateCommittedDuplicateGroups } from "./system1-eval-independent-units.js";
import type {
  System1AccountingCount,
  System1SplitAccountingFunnel,
} from "./system1-eval-types.js";
import type { System1Split } from "../system1-types.js";

export interface System1AccountingSample {
  readonly duplicateGroup: string;
  readonly exportExclusionReason: string | null;
  readonly labelExclusionReason: string | null;
  readonly hasCandidates: boolean;
  readonly candidateMiss: boolean;
  readonly committed: boolean;
  readonly exact: boolean;
}

function count(
  samples: readonly System1AccountingSample[],
): System1AccountingCount {
  return {
    rows: samples.length,
    duplicateGroups: new Set(
      samples.map(({ duplicateGroup }) => duplicateGroup),
    ).size,
  };
}

function countByReason(
  samples: readonly System1AccountingSample[],
  reasonFor: (sample: System1AccountingSample) => string | null,
): Readonly<Record<string, System1AccountingCount>> {
  const grouped = new Map<string, System1AccountingSample[]>();
  for (const sample of samples) {
    const reason = reasonFor(sample);
    if (reason === null) continue;
    const rows = grouped.get(reason) ?? [];
    rows.push(sample);
    grouped.set(reason, rows);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([reason, rows]) => [reason, count(rows)]),
  );
}

/** Builds a row/group funnel and checks that every remaining stage is a subset. */
export function computeSystem1AccountingFunnel(
  split: System1Split,
  samples: readonly System1AccountingSample[],
): System1SplitAccountingFunnel {
  if (samples.some(({ duplicateGroup }) => duplicateGroup.length === 0))
    throw new Error("Every accounting row must have a duplicate group.");
  const exported = samples.filter(
    ({ exportExclusionReason }) => exportExclusionReason === null,
  );
  const trusted = exported.filter(
    ({ labelExclusionReason }) => labelExclusionReason === null,
  );
  const eligible = trusted.filter(({ hasCandidates }) => hasCandidates);
  const modelEligible = eligible.filter(({ candidateMiss }) => !candidateMiss);
  const committed = modelEligible.filter(({ committed }) => committed);
  const candidateMisses = eligible.filter(({ candidateMiss }) => candidateMiss);
  const candidateMissesWithoutCandidates = trusted.filter(
    ({ candidateMiss, hasCandidates }) => !hasCandidates && candidateMiss,
  );
  const candidateMissCommits = trusted.filter(
    ({ candidateMiss, committed: isCommitted }) => candidateMiss && isCommitted,
  );
  const exactCount: System1AccountingCount = {
    rows: committed.filter(({ exact: isExact }) => isExact).length,
    duplicateGroups: aggregateCommittedDuplicateGroups(committed, {
      duplicateGroup: ({ duplicateGroup }) => duplicateGroup,
      committed: () => true,
      exact: ({ exact: isExact }) => isExact,
    }).filter(({ exact: isGroupExact }) => isGroupExact).length,
  };
  const funnel: System1SplitAccountingFunnel = {
    split,
    rawCorpus: count(samples),
    exportExclusions: count(
      samples.filter(
        ({ exportExclusionReason }) => exportExclusionReason !== null,
      ),
    ),
    exportExclusionsByReason: countByReason(
      samples,
      ({ exportExclusionReason }) => exportExclusionReason,
    ),
    afterExportExclusions: count(exported),
    untrustedLabelsByReason: countByReason(
      exported,
      ({ labelExclusionReason }) => labelExclusionReason,
    ),
    trusted: count(trusted),
    eligibleWithCandidates: count(eligible),
    candidateMisses: count(candidateMisses),
    candidateMissesWithoutCandidates: count(candidateMissesWithoutCandidates),
    eligibleWithoutCandidateMiss: count(modelEligible),
    committed: count(committed),
    exact: exactCount,
    candidateMissCommits: count(candidateMissCommits),
  };
  const stages = [
    funnel.rawCorpus,
    funnel.afterExportExclusions,
    funnel.trusted,
    funnel.eligibleWithCandidates,
    funnel.eligibleWithoutCandidateMiss,
    funnel.committed,
    funnel.exact,
  ];
  if (
    stages.some(
      (stage, index) =>
        index > 0 &&
        (stage.rows > stages[index - 1].rows ||
          stage.duplicateGroups > stages[index - 1].duplicateGroups),
    )
  )
    throw new Error(
      "Accounting funnel stages must be monotonically decreasing.",
    );
  return funnel;
}
