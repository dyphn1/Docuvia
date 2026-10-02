/** Phase 0 helpers that mirror the existing Tier A ScopeResolver call path. */

export interface ReplayCallSite {
  readonly sourceFunction: string;
  readonly targetFunction: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly calleeName?: string;
  readonly receiverText?: string;
  readonly calleeKind?: "bare" | "member" | "this" | "arg-chain" | "computed";
}

export type ParsedCallMatch =
  | { readonly status: "unique"; readonly call: ReplayCallSite }
  | {
      readonly status: "excluded";
      readonly reason:
        | "invalid-position"
        | "no-worker-call-at-position"
        | "multiple-worker-calls-at-position";
    };

export function matchParsedCallAtPosition(
  calls: readonly ReplayCallSite[],
  line: number,
  column: number,
): ParsedCallMatch {
  if (
    !Number.isSafeInteger(line) ||
    line < 0 ||
    !Number.isSafeInteger(column) ||
    column < 0
  )
    return { status: "excluded", reason: "invalid-position" };

  const matches = calls.filter(
    (call) => call.startLine === line && call.startColumn === column,
  );
  if (matches.length === 0)
    return { status: "excluded", reason: "no-worker-call-at-position" };
  if (matches.length !== 1)
    return {
      status: "excluded",
      reason: "multiple-worker-calls-at-position",
    };
  return { status: "unique", call: matches[0] };
}

export interface ReplayImport {
  readonly localName: string;
  readonly originalName?: string;
  readonly modulePath?: string;
}

export type ReceiverCategory =
  | "bare"
  | "this"
  | "super"
  | "imported-identifier"
  | "imported-property-chain"
  | "local-identifier"
  | "unbound-identifier"
  | "this-property-chain"
  | "member-property-chain"
  | "call-result-chain"
  | "computed"
  | "other-expression"
  | "unknown";

export type ResolverBinding =
  | "not-applicable"
  | "this-super"
  | "import-binding-name-match"
  | "same-file-callee-name-available"
  | "none"
  | "unsupported-shape";

export interface ReceiverClassification {
  readonly receiverCategory: ReceiverCategory;
  /** Syntactic/registered-name route hint, not a claim that ScopeResolver resolved this receiver. */
  readonly resolverRouteHint: ResolverBinding;
}

const IDENTIFIER = /^[$A-Z_a-z][$\w]*$/;

export function classifyReceiver(
  call: Pick<ReplayCallSite, "calleeName" | "calleeKind" | "receiverText">,
  imports: readonly ReplayImport[],
  localSymbols: ReadonlySet<string>,
): ReceiverClassification {
  const kind = call.calleeKind;
  const receiver = call.receiverText?.trim();
  const callee = call.calleeName;
  if (kind === "arg-chain")
    return {
      receiverCategory: "call-result-chain",
      resolverRouteHint: "unsupported-shape",
    };
  if (kind === "computed")
    return {
      receiverCategory: "computed",
      resolverRouteHint: "unsupported-shape",
    };
  if (kind === "bare" || (!receiver && kind !== "member" && kind !== "this"))
    return { receiverCategory: "bare", resolverRouteHint: "not-applicable" };
  if (receiver === "this")
    return { receiverCategory: "this", resolverRouteHint: "this-super" };
  if (receiver === "super")
    return { receiverCategory: "super", resolverRouteHint: "this-super" };
  if (!receiver)
    return { receiverCategory: "unknown", resolverRouteHint: "none" };

  const importedNames = new Set(imports.map((item) => item.localName));
  if (importedNames.has(receiver))
    return {
      receiverCategory: "imported-identifier",
      resolverRouteHint: "import-binding-name-match",
    };

  const firstSegment = receiver.split(/[.[]/, 1)[0];
  const hasImportPrefix = importedNames.has(firstSegment);
  const sameFileFallback = Boolean(callee && localSymbols.has(callee));
  const resolverRouteHint: ResolverBinding = sameFileFallback
    ? "same-file-callee-name-available"
    : "none";

  if (receiver.startsWith("this."))
    return { receiverCategory: "this-property-chain", resolverRouteHint };
  if (receiver.includes("("))
    return { receiverCategory: "call-result-chain", resolverRouteHint };
  if (IDENTIFIER.test(receiver))
    return {
      receiverCategory: localSymbols.has(receiver)
        ? "local-identifier"
        : "unbound-identifier",
      resolverRouteHint,
    };
  if (receiver.includes(".") || receiver.includes("["))
    return {
      receiverCategory: hasImportPrefix
        ? "imported-property-chain"
        : "member-property-chain",
      resolverRouteHint,
    };
  return { receiverCategory: "other-expression", resolverRouteHint };
}

export interface ScopeResolverTarget {
  readonly targetFile: string;
  readonly targetSymbol: string;
}

export interface ScopeResolverLike {
  resolveCall(
    sourceFilePath: string,
    callName: string,
  ): ScopeResolverTarget | null;
  resolveMemberCall(
    sourceFilePath: string,
    receiverText: string,
    calleeName: string,
  ): ScopeResolverTarget | null;
}

export type ScopeResolverProposal =
  | {
      readonly status: "resolved";
      readonly target: ScopeResolverTarget;
      readonly resolverPath: "member" | "bare";
    }
  | {
      readonly status: "unresolved";
      readonly target: null;
      readonly resolverPath: "member" | "bare";
    }
  | {
      readonly status: "unsupported";
      readonly target: null;
      readonly resolverPath: "unsupported";
    };

/** Mirrors GraphPersisterService's shape gate and GraphPersisterService's resolveCallTarget. */
export function resolveScopeResolverProposal(
  resolver: ScopeResolverLike,
  sourceFilePath: string,
  call: ReplayCallSite,
): ScopeResolverProposal {
  const kind = call.calleeKind;
  if (
    kind === "arg-chain" ||
    kind === "computed" ||
    (!kind && call.targetFunction.includes("("))
  )
    return {
      status: "unsupported",
      target: null,
      resolverPath: "unsupported",
    };

  const member =
    (kind === "member" || kind === "this") &&
    Boolean(call.calleeName) &&
    Boolean(call.receiverText);
  const target = member
    ? resolver.resolveMemberCall(
        sourceFilePath,
        call.receiverText!,
        call.calleeName!,
      )
    : resolver.resolveCall(sourceFilePath, call.targetFunction);
  const resolverPath = member ? "member" : "bare";
  return target
    ? { status: "resolved", target, resolverPath }
    : { status: "unresolved", target: null, resolverPath };
}

export interface BaselineCallRow {
  readonly sampleId: string;
  readonly repoFamily: string;
  readonly split: string;
  readonly duplicateGroup: string;
  readonly receiverCategory?: ReceiverCategory;
  readonly positionStatus: "unique" | "excluded";
  readonly scopeResolverStatus:
    "resolved" | "unresolved" | "unsupported" | "not-run";
  readonly resolverTargetId: string | null;
}

export interface BaselineLabel {
  readonly candidateTargetIds: readonly string[];
  readonly positiveTargetIds: readonly string[];
}

export interface BaselineCounts {
  readonly sourceRows: number;
  readonly mappedRows: number;
  readonly excludedRows: number;
  readonly resolverEligibleRows: number;
  readonly resolverResolvedRows: number;
  readonly goldRows: number;
  readonly candidateCoveredRows: number;
  readonly resolverCorrectRows: number;
  readonly resolverLabeledResolvedRows: number;
  readonly duplicateGroups: number;
  readonly candidateRecall: number | null;
  readonly resolverTop1OverGold: number | null;
  readonly resolverPrecisionWhenResolved: number | null;
}

export interface BaselineSummary extends BaselineCounts {
  readonly bySplit: Readonly<Record<string, BaselineCounts>>;
  readonly byFamily: Readonly<Record<string, BaselineCounts>>;
  readonly byReceiverCategory: Readonly<Record<string, BaselineCounts>>;
}

export function summarizeBaselineRows(
  rows: readonly BaselineCallRow[],
  labels: ReadonlyMap<string, BaselineLabel>,
): BaselineSummary {
  const collect = (subset: readonly BaselineCallRow[]): BaselineCounts => {
    const mapped = subset.filter((row) => row.positionStatus === "unique");
    const eligible = mapped.filter(
      (row) =>
        row.scopeResolverStatus !== "unsupported" &&
        row.scopeResolverStatus !== "not-run",
    );
    const resolved = eligible.filter(
      (row) => row.scopeResolverStatus === "resolved",
    );
    const gold = subset.filter(
      (row) => (labels.get(row.sampleId)?.positiveTargetIds.length ?? 0) > 0,
    );
    const candidateCovered = gold.filter((row) => {
      const label = labels.get(row.sampleId);
      return Boolean(
        label &&
        label.candidateTargetIds.some((candidate) =>
          label.positiveTargetIds.includes(candidate),
        ),
      );
    });
    const resolverCorrect = gold.filter((row) => {
      const target = row.resolverTargetId;
      return (
        target !== null &&
        labels.get(row.sampleId)?.positiveTargetIds.includes(target)
      );
    });
    const labeledResolved = resolved.filter((row) => labels.has(row.sampleId));
    const duplicateGroups = new Set(subset.map((row) => row.duplicateGroup));
    return {
      sourceRows: subset.length,
      mappedRows: mapped.length,
      excludedRows: subset.length - mapped.length,
      resolverEligibleRows: eligible.length,
      resolverResolvedRows: resolved.length,
      goldRows: gold.length,
      candidateCoveredRows: candidateCovered.length,
      resolverCorrectRows: resolverCorrect.length,
      resolverLabeledResolvedRows: labeledResolved.length,
      duplicateGroups: duplicateGroups.size,
      candidateRecall: gold.length
        ? candidateCovered.length / gold.length
        : null,
      resolverTop1OverGold: gold.length
        ? resolverCorrect.length / gold.length
        : null,
      resolverPrecisionWhenResolved: labeledResolved.length
        ? labeledResolved.filter((row) =>
            labels
              .get(row.sampleId)
              ?.positiveTargetIds.includes(row.resolverTargetId ?? ""),
          ).length / labeledResolved.length
        : null,
    };
  };

  const groupBy = (keyOf: (row: BaselineCallRow) => string | undefined) => {
    const groups = new Map<string, BaselineCallRow[]>();
    for (const row of rows) {
      const key = keyOf(row) ?? "unknown";
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    return Object.fromEntries(
      [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, subset]) => [key, collect(subset)]),
    );
  };

  return {
    ...collect(rows),
    bySplit: groupBy((row) => row.split),
    byFamily: groupBy((row) => row.repoFamily),
    byReceiverCategory: groupBy((row) => row.receiverCategory),
  };
}
