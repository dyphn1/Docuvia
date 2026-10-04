import {
  buildQualifiedBaseKey,
  buildUniqueNodeKey,
} from "../../lib/core/src/graph/node-key.js";
import { ANONYMOUS_SYMBOL_NAME } from "../../lib/core/src/constants/symbols.js";

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
  readonly originalName: string;
  readonly modulePath: string;
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

export interface ParsedGraphFileLike {
  readonly file: string;
  readonly data: {
    readonly imports?: readonly ReplayImport[];
    readonly functions?: readonly {
      readonly name: string;
      readonly startLine: number;
      readonly endLine?: number;
      readonly containerName?: string;
    }[];
    readonly classes?: readonly {
      readonly name: string;
      readonly startLine: number;
      readonly endLine?: number;
    }[];
    readonly variables?: readonly {
      readonly name: string;
      readonly startLine: number;
      readonly endLine?: number;
    }[];
  };
}

export interface ScopeResolverRegistryLike extends ScopeResolverLike {
  registerFile(
    filePath: string,
    imports: ReplayImport[],
    exports: string[],
    locals: string[],
  ): void;
}

/** Matches GraphPersisterService.registerResolverFiles: register the complete parsed batch before
 *  replaying any call, using the same local-symbol families. */
export function registerScopeResolverFiles(
  resolver: ScopeResolverRegistryLike,
  parsedResults: readonly ParsedGraphFileLike[],
): void {
  for (const result of parsedResults) {
    const locals = [
      ...(result.data.functions ?? []).map((item) => item.name),
      ...(result.data.classes ?? []).map((item) => item.name),
      ...(result.data.variables ?? []).map((item) => item.name),
    ];
    resolver.registerFile(
      result.file,
      [...(result.data.imports ?? [])],
      [],
      locals,
    );
  }
}

export interface ParsedSymbolNodeKeyIndex {
  readonly files: ReadonlySet<string>;
  readonly byFileSymbol: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly declarationsByFile: ReadonlyMap<
    string,
    readonly ParsedSymbolDeclarationNode[]
  >;
}

export interface ParsedSymbolDeclarationNode {
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly containerName?: string;
  readonly nodeKey: string;
}

/** Mirrors GraphPersisterService's function → class → variable insertion order and collision
 *  policy so ScopeResolver's `(file, symbol)` proposal can be compared with a graph node key. */
export function buildParsedSymbolNodeKeyIndex(
  parsedResults: readonly ParsedGraphFileLike[],
): ParsedSymbolNodeKeyIndex {
  const byFileSymbol = new Map<string, Map<string, string>>();
  const declarationsByFile = new Map<string, ParsedSymbolDeclarationNode[]>();
  for (const result of parsedResults) {
    const usedNodeKeys = new Set<string>([result.file]);
    const symbols = new Map<string, string>();
    const declarations: ParsedSymbolDeclarationNode[] = [];
    byFileSymbol.set(result.file.replaceAll("\\", "/"), symbols);
    declarationsByFile.set(result.file.replaceAll("\\", "/"), declarations);
    for (const fn of result.data.functions ?? []) {
      const key = buildUniqueNodeKey(
        usedNodeKeys,
        buildQualifiedBaseKey(result.file, fn.name, fn.containerName),
        fn.startLine,
      );
      usedNodeKeys.add(key);
      symbols.set(fn.name, key);
      declarations.push({
        name: fn.name,
        startLine: fn.startLine,
        endLine: fn.endLine ?? fn.startLine,
        ...(fn.containerName === undefined
          ? {}
          : { containerName: fn.containerName }),
        nodeKey: key,
      });
    }
    for (const cls of result.data.classes ?? []) {
      const key = buildUniqueNodeKey(
        usedNodeKeys,
        `${result.file}#${cls.name}`,
        cls.startLine,
      );
      usedNodeKeys.add(key);
      symbols.set(cls.name, key);
      declarations.push({
        name: cls.name,
        startLine: cls.startLine,
        endLine: cls.endLine ?? cls.startLine,
        nodeKey: key,
      });
    }
    for (const variable of result.data.variables ?? []) {
      const key = buildUniqueNodeKey(
        usedNodeKeys,
        `${result.file}#${variable.name}`,
        variable.startLine,
      );
      usedNodeKeys.add(key);
      symbols.set(variable.name, key);
      declarations.push({
        name: variable.name,
        startLine: variable.startLine,
        endLine: variable.endLine ?? variable.startLine,
        nodeKey: key,
      });
    }
  }
  return {
    files: new Set(
      parsedResults.map((result) => result.file.replaceAll("\\", "/")),
    ),
    byFileSymbol,
    declarationsByFile,
  };
}

export type ParsedDeclarationNodeMatch =
  | { readonly status: "unique"; readonly nodeKey: string }
  | { readonly status: "ambiguous"; readonly candidates: readonly string[] }
  | { readonly status: "not-found" };

/** Maps a language-service definition by its declaration span, never by bare name alone. */
export function nodeKeyForParsedDeclarationAtPosition(
  index: ParsedSymbolNodeKeyIndex,
  filePath: string,
  name: string,
  line: number,
  containerName?: string | null,
): ParsedDeclarationNodeMatch {
  const normalizedFile = filePath.replaceAll("\\", "/");
  const candidates = (
    index.declarationsByFile.get(normalizedFile) ?? []
  ).filter(
    (declaration) =>
      declaration.name === name &&
      declaration.startLine <= line &&
      line <= declaration.endLine,
  );
  if (candidates.length === 0) return { status: "not-found" };
  if (candidates.length === 1)
    return { status: "unique", nodeKey: candidates[0].nodeKey };

  if (containerName) {
    const containerMatches = candidates.filter(
      (candidate) => candidate.containerName === containerName,
    );
    if (containerMatches.length === 1)
      return { status: "unique", nodeKey: containerMatches[0].nodeKey };
  }
  return {
    status: "ambiguous",
    candidates: candidates.map((candidate) => candidate.nodeKey),
  };
}

/** Mirrors the target node fallback in GraphPersisterService.resolveTargetNodeId. */
export function nodeKeyForResolverTarget(
  index: ParsedSymbolNodeKeyIndex,
  target: ScopeResolverTarget,
): string | null {
  const filePath = target.targetFile.replaceAll("\\", "/");
  return (
    index.byFileSymbol.get(filePath)?.get(target.targetSymbol) ??
    (index.files.has(filePath) ? filePath : null)
  );
}

/** Mirrors GraphPersisterService.resolveSourceNodeId for a parsed call's enclosing function. */
export function nodeKeyForSourceFunction(
  index: ParsedSymbolNodeKeyIndex,
  filePath: string,
  sourceFunction: string,
): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  if (sourceFunction !== ANONYMOUS_SYMBOL_NAME) {
    const symbolKey = index.byFileSymbol
      .get(normalizedPath)
      ?.get(sourceFunction);
    if (symbolKey) return symbolKey;
  }
  return normalizedPath;
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
  readonly callShape?: string;
  readonly positionStatus: "unique" | "excluded";
  readonly scopeResolverStatus:
    "resolved" | "unresolved" | "unsupported" | "unmapped-target" | "not-run";
  readonly resolverTargetId: string | null;
}

/** Guards a source-row sidecar against omissions, duplicates, or injected sample ids. */
export function assertExactSampleCoverage(
  name: string,
  expectedSampleIds: ReadonlySet<string>,
  rows: readonly { readonly sampleId: string }[],
): void {
  const actualSampleIds = new Set<string>();
  for (const row of rows) {
    if (actualSampleIds.has(row.sampleId))
      throw new Error(`${name} contains duplicate sample id ${row.sampleId}.`);
    actualSampleIds.add(row.sampleId);
  }
  if (
    rows.length !== expectedSampleIds.size ||
    actualSampleIds.size !== expectedSampleIds.size ||
    [...expectedSampleIds].some((sampleId) => !actualSampleIds.has(sampleId)) ||
    [...actualSampleIds].some((sampleId) => !expectedSampleIds.has(sampleId))
  )
    throw new Error(`${name} does not cover the exact expected sample-id set.`);
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
  readonly byCallShape: Readonly<Record<string, BaselineCounts>>;
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
    byCallShape: groupBy((row) => row.callShape),
  };
}
