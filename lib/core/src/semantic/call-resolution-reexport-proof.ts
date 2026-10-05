import { CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE } from "@workspace/contracts";
import type {
  AstDeclaredDeclaration,
  AstReexportDescriptor,
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisSourceFile,
  CallResolutionStrictProof,
} from "@workspace/contracts";
import {
  candidateTargetKeyForDeclaration,
  isWorkspaceBoundSourcePath,
  resolveDirectConfiguredImportPath,
  resolveDirectRelativeImportPath,
  type IndexedWorkspace,
} from "./call-resolution-hypothesis-index.js";
import { HASH_PATTERN, hash } from "./call-resolution-hypothesis-internal.js";

const MAX_REEXPORT_DEPTH = 16;

type AbstentionReason = Exclude<
  CallResolutionStrictProof["reason"],
  "unique-this-owner-member" | "unique-named-import"
>;

interface TraceTarget {
  readonly filePath: string;
  readonly targetName: string;
  readonly targetKey: string;
  readonly declaration: AstDeclaredDeclaration;
  readonly hops: number;
}

type TraceOutcome =
  | { readonly status: "found"; readonly target: TraceTarget }
  | { readonly status: "not-found"; readonly sawReexport: boolean }
  | { readonly status: "abstained"; readonly reason: AbstentionReason };

type TraceCandidate =
  | { readonly status: "ready"; readonly target: TraceTarget | null }
  | { readonly status: "abstained"; readonly reason: AbstentionReason };

type CompleteReexportSource = CallResolutionHypothesisSourceFile & {
  readonly sourceContentHash: string;
  readonly imports: NonNullable<CallResolutionHypothesisSourceFile["imports"]>;
  readonly exports: NonNullable<CallResolutionHypothesisSourceFile["exports"]>;
  readonly reexports: NonNullable<
    CallResolutionHypothesisSourceFile["reexports"]
  >;
  readonly declaredTypeFacts: NonNullable<
    CallResolutionHypothesisSourceFile["declaredTypeFacts"]
  >;
};

type PreparedTrace =
  | {
      readonly status: "ready";
      readonly source: CompleteReexportSource;
      readonly visited: ReadonlySet<string>;
    }
  | { readonly status: "abstained"; readonly reason: AbstentionReason };

interface TraceContext {
  readonly workspace: IndexedWorkspace;
  readonly dependencies: Map<string, string>;
}

function abstain(reason: AbstentionReason): CallResolutionStrictProof {
  return {
    status: "abstained",
    targetKey: null,
    ruleSignature: null,
    reason,
  };
}

function sourceSnapshotAbstentionReason(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): AbstentionReason | null {
  const indexedHash = workspace.sourceContentHashByFile.get(
    request.callerFilePath,
  );
  const callerHash = request.callerSourceContentHash;
  if (!indexedHash || !callerHash) return "source-snapshot-unbound";
  if (indexedHash !== callerHash) return "source-snapshot-mismatch";
  return null;
}

function hasOneIndexedCallSite(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): boolean {
  const callSites = workspace.callSiteShapesByFile.get(request.callerFilePath);
  if (!callSites) return false;
  const requestedHash = hash(request.callSite);
  return (
    callSites.filter((callSite) => hash(callSite) === requestedHash).length ===
    1
  );
}

function isNamedImportRequest(
  request: CallResolutionHypothesisRequest,
): boolean {
  return (
    request.callSite.calleeKind === "bare" &&
    request.callSite.calleeBinding?.kind === "import"
  );
}

function isSupportedImportPath(modulePath: string): boolean {
  return (
    modulePath.startsWith("./") ||
    modulePath.startsWith("../") ||
    modulePath.startsWith("@/")
  );
}

function resolveModulePath(
  fromFile: string,
  modulePath: string,
  workspace: IndexedWorkspace,
): string | null {
  if (!isSupportedImportPath(modulePath)) return null;
  const availableFilePaths = [...workspace.sourceFilesByPath.keys()];
  const relative = modulePath.startsWith("./") || modulePath.startsWith("../");
  const resolved = relative
    ? resolveDirectRelativeImportPath(
        fromFile,
        modulePath,
        availableFilePaths,
        true,
      )
    : resolveDirectConfiguredImportPath(
        fromFile,
        modulePath,
        availableFilePaths,
        workspace.configuredPathAliases,
        true,
      );
  return resolved && isWorkspaceBoundSourcePath(resolved) ? resolved : null;
}

function isCompleteReexportSource(
  source: CallResolutionHypothesisSourceFile | undefined,
): source is CompleteReexportSource {
  return Boolean(
    source &&
    HASH_PATTERN.test(source.sourceContentHash ?? "") &&
    source.imports &&
    source.exports &&
    source.reexports &&
    source.declaredTypeFacts,
  );
}

function isDirectFunctionDeclaration(
  declaration: AstDeclaredDeclaration,
  name: string,
): boolean {
  return (
    declaration.name === name &&
    declaration.owner.kind === "program" &&
    declaration.kind === "function" &&
    !declaration.unsupportedReason
  );
}

function declarationSpanMatches(
  declaration: AstDeclaredDeclaration,
  span: { readonly start: number; readonly end: number } | undefined,
): boolean {
  return Boolean(
    span &&
    declaration.declarationSpan.start === span.start &&
    declaration.declarationSpan.end === span.end,
  );
}

function uniqueDirectFunction(
  source: CallResolutionHypothesisSourceFile,
  name: string,
): AstDeclaredDeclaration | null {
  const declarations = source.declaredTypeFacts?.declarations.filter(
    (declaration) => isDirectFunctionDeclaration(declaration, name),
  );
  return declarations?.length === 1 ? (declarations[0] ?? null) : null;
}

function directExportTarget(
  source: CallResolutionHypothesisSourceFile,
  exportedName: string,
): AstDeclaredDeclaration | null {
  const descriptors = source.exports?.filter(
    ({ name }) => name === exportedName,
  );
  if (!descriptors || descriptors.length !== 1) return null;
  const descriptor = descriptors[0];
  if (!descriptor || descriptor.type !== "function") return null;
  if (exportedName !== "default")
    return uniqueDirectFunction(source, exportedName);
  return defaultFunctionExportTarget(source, descriptor);
}

function defaultFunctionExportTarget(
  source: CallResolutionHypothesisSourceFile,
  descriptor: NonNullable<
    CallResolutionHypothesisSourceFile["exports"]
  >[number],
): AstDeclaredDeclaration | null {
  const declarations = source.declaredTypeFacts?.declarations.filter(
    (declaration) =>
      declaration.owner.kind === "program" &&
      declaration.kind === "function" &&
      !declaration.unsupportedReason &&
      declarationSpanMatches(declaration, descriptor.declarationSpan),
  );
  return declarations?.length === 1 ? (declarations[0] ?? null) : null;
}

function localDeclarationTarget(
  source: CallResolutionHypothesisSourceFile,
  localName: string,
): AstDeclaredDeclaration | null {
  return uniqueDirectFunction(source, localName);
}

function uniqueFinalCandidate(
  workspace: IndexedWorkspace,
  filePath: string,
  declaration: AstDeclaredDeclaration,
  targetKey: string,
): boolean {
  const name = declaration.name;
  if (!name) return false;
  const matches = (workspace.candidatesByMember.get(name) ?? []).filter(
    (candidate) =>
      candidate.owner.kind === "program" &&
      candidate.declarations.some(
        (candidateDeclaration) => candidateDeclaration.name === name,
      ),
  );
  return (
    matches.length === 1 &&
    matches[0]?.filePath === filePath &&
    matches[0]?.targetKey === targetKey &&
    matches[0]?.inventoryComplete === true
  );
}

function reexportByName<K extends "named" | "local" | "namespace">(
  source: CallResolutionHypothesisSourceFile,
  kind: K,
  exportedName: string,
): Extract<AstReexportDescriptor, { readonly kind: K }>[] {
  return (
    source.reexports?.filter(
      (
        descriptor,
      ): descriptor is Extract<AstReexportDescriptor, { readonly kind: K }> =>
        descriptor.kind === kind && descriptor.exportedName === exportedName,
    ) ?? []
  );
}

function addConfiguredPathDependency(
  modulePath: string,
  context: TraceContext,
): void {
  const aliases = context.workspace.configuredPathAliases;
  if (modulePath.startsWith("@/") && aliases) {
    context.dependencies.set(
      aliases.configurationFilePath,
      aliases.sourceContentHash,
    );
  }
}

function prepareTrace(
  filePath: string,
  symbol: string,
  depth: number,
  visited: ReadonlySet<string>,
  context: TraceContext,
): PreparedTrace {
  if (depth > MAX_REEXPORT_DEPTH)
    return { status: "abstained", reason: "unresolved-call-binding" };
  const pairKey = filePath + "\0" + symbol;
  if (visited.has(pairKey))
    return { status: "abstained", reason: "unresolved-call-binding" };

  const source = context.workspace.sourceFilesByPath.get(filePath);
  if (!isCompleteReexportSource(source))
    return { status: "abstained", reason: "incomplete-inventory" };
  context.dependencies.set(filePath, source.sourceContentHash);

  const nextVisited = new Set(visited);
  nextVisited.add(pairKey);
  return { status: "ready", source, visited: nextVisited };
}

function reexportForSymbolExists(
  source: CompleteReexportSource,
  symbol: string,
): boolean {
  return (
    reexportByName(source, "named", symbol).length > 0 ||
    reexportByName(source, "local", symbol).length > 0 ||
    reexportByName(source, "namespace", symbol).length > 0 ||
    source.reexports.some((descriptor) => descriptor.kind === "star")
  );
}

function traceReexportModule(
  filePath: string,
  modulePath: string,
  symbol: string,
  depth: number,
  visited: ReadonlySet<string>,
  context: TraceContext,
): TraceOutcome {
  const targetPath = resolveModulePath(filePath, modulePath, context.workspace);
  if (!targetPath)
    return { status: "abstained", reason: "unsupported-call-shape" };
  addConfiguredPathDependency(modulePath, context);
  return traceExport(targetPath, symbol, depth + 1, visited, context);
}

function candidateFromExplicitOutcome(outcome: TraceOutcome): TraceCandidate {
  if (outcome.status === "abstained") return outcome;
  if (outcome.status === "not-found")
    return { status: "abstained", reason: "unresolved-call-binding" };
  return { status: "ready", target: outcome.target };
}

function traceNamedReexport(
  filePath: string,
  descriptor: Extract<AstReexportDescriptor, { readonly kind: "named" }>,
  depth: number,
  visited: ReadonlySet<string>,
  context: TraceContext,
): TraceCandidate {
  if (descriptor.isTypeOnly)
    return { status: "abstained", reason: "unsupported-call-shape" };
  return candidateFromExplicitOutcome(
    traceReexportModule(
      filePath,
      descriptor.modulePath,
      descriptor.importedName,
      depth,
      visited,
      context,
    ),
  );
}

function isSupportedLocalImportBinding(
  binding: NonNullable<CallResolutionHypothesisSourceFile["imports"]>[number],
): boolean {
  return !(
    binding.viaReexport ||
    binding.isTypeOnly ||
    binding.originalName === "*" ||
    (binding.originalName === "default" && !binding.isCombinedDefaultImport)
  );
}

function localDeclarationCandidate(
  filePath: string,
  source: CompleteReexportSource,
  localName: string,
  depth: number,
): TraceCandidate {
  const declaration = localDeclarationTarget(source, localName);
  if (!declaration)
    return { status: "abstained", reason: "unresolved-call-binding" };
  const targetKey = candidateTargetKeyForDeclaration(filePath, declaration);
  if (!targetKey)
    return { status: "abstained", reason: "no-unique-owner-candidate" };
  return {
    status: "ready",
    target: {
      filePath,
      targetName: declaration.name ?? localName,
      targetKey,
      declaration,
      hops: depth,
    },
  };
}

function traceLocalReexport(
  filePath: string,
  source: CompleteReexportSource,
  descriptor: Extract<AstReexportDescriptor, { readonly kind: "local" }>,
  depth: number,
  visited: ReadonlySet<string>,
  context: TraceContext,
): TraceCandidate {
  if (descriptor.isTypeOnly)
    return { status: "abstained", reason: "unsupported-call-shape" };
  const bindings = source.imports.filter(
    ({ localName }) => localName === descriptor.localName,
  );
  if (bindings.length > 1)
    return { status: "abstained", reason: "no-unique-owner-candidate" };
  const binding = bindings[0];
  if (!binding)
    return localDeclarationCandidate(
      filePath,
      source,
      descriptor.localName,
      depth,
    );
  if (!isSupportedLocalImportBinding(binding))
    return { status: "abstained", reason: "unsupported-call-shape" };
  return candidateFromExplicitOutcome(
    traceReexportModule(
      filePath,
      binding.modulePath,
      binding.originalName,
      depth,
      visited,
      context,
    ),
  );
}

function traceExplicitReexport(
  filePath: string,
  source: CompleteReexportSource,
  symbol: string,
  depth: number,
  visited: ReadonlySet<string>,
  context: TraceContext,
): TraceCandidate {
  const named = reexportByName(source, "named", symbol);
  const local = reexportByName(source, "local", symbol);
  const namespace = reexportByName(source, "namespace", symbol);
  if (namespace.length > 0)
    return { status: "abstained", reason: "unsupported-call-shape" };
  if (named.length + local.length > 1)
    return { status: "abstained", reason: "no-unique-owner-candidate" };
  if (named.length === 1)
    return traceNamedReexport(filePath, named[0]!, depth, visited, context);
  if (local.length === 1)
    return traceLocalReexport(
      filePath,
      source,
      local[0]!,
      depth,
      visited,
      context,
    );
  return { status: "ready", target: null };
}

function directExportCandidate(
  filePath: string,
  source: CompleteReexportSource,
  symbol: string,
  depth: number,
): TraceCandidate {
  const descriptors = source.exports.filter(({ name }) => name === symbol);
  if (descriptors.length === 0) return { status: "ready", target: null };
  if (descriptors.length !== 1)
    return { status: "abstained", reason: "no-unique-owner-candidate" };
  const declaration = directExportTarget(source, symbol);
  if (!declaration)
    return { status: "abstained", reason: "no-unique-owner-candidate" };
  const targetKey = candidateTargetKeyForDeclaration(filePath, declaration);
  if (!targetKey)
    return { status: "abstained", reason: "no-unique-owner-candidate" };
  return {
    status: "ready",
    target: {
      filePath,
      targetName: declaration.name ?? symbol,
      targetKey,
      declaration,
      hops: depth,
    },
  };
}

function traceStarReexports(
  filePath: string,
  source: CompleteReexportSource,
  symbol: string,
  depth: number,
  visited: ReadonlySet<string>,
  context: TraceContext,
): TraceCandidate {
  const starTargets: TraceTarget[] = [];
  for (const descriptor of source.reexports) {
    if (descriptor.kind !== "star") continue;
    if (descriptor.isTypeOnly)
      return { status: "abstained", reason: "unsupported-call-shape" };
    // ECMAScript star exports never forward the default binding.
    if (symbol === "default") continue;
    const target = traceReexportModule(
      filePath,
      descriptor.modulePath,
      symbol,
      depth,
      visited,
      context,
    );
    if (target.status === "abstained") return target;
    if (target.status === "found") starTargets.push(target.target);
  }
  if (starTargets.length > 1)
    return { status: "abstained", reason: "no-unique-owner-candidate" };
  return { status: "ready", target: starTargets[0] ?? null };
}

function chooseTraceTarget(
  direct: TraceTarget | null,
  explicit: TraceTarget | null,
  star: TraceTarget | null,
): TraceCandidate {
  if ((direct && (explicit || star)) || (explicit && star))
    return { status: "abstained", reason: "no-unique-owner-candidate" };
  return { status: "ready", target: direct ?? explicit ?? star };
}

function traceExport(
  filePath: string,
  symbol: string,
  depth: number,
  visited: ReadonlySet<string>,
  context: TraceContext,
): TraceOutcome {
  const prepared = prepareTrace(filePath, symbol, depth, visited, context);
  if (prepared.status === "abstained") return prepared;
  const { source } = prepared;
  const explicit = traceExplicitReexport(
    filePath,
    source,
    symbol,
    depth,
    prepared.visited,
    context,
  );
  if (explicit.status === "abstained") return explicit;
  const direct = directExportCandidate(filePath, source, symbol, depth);
  if (direct.status === "abstained") return direct;
  const stars = traceStarReexports(
    filePath,
    source,
    symbol,
    depth,
    prepared.visited,
    context,
  );
  if (stars.status === "abstained") return stars;
  const selected = chooseTraceTarget(
    direct.target,
    explicit.target,
    stars.target,
  );
  if (selected.status === "abstained") return selected;
  if (selected.target) return { status: "found", target: selected.target };
  return {
    status: "not-found",
    sawReexport: reexportForSymbolExists(source, symbol),
  };
}

/*
 * Helpers above keep the trace's rule branches independent: explicit exports, direct declarations,
 * and star providers are checked separately before their targets are combined.
 */

function importDescriptorForRequest(
  request: CallResolutionHypothesisRequest,
  caller: CallResolutionHypothesisSourceFile,
): AstImportDescriptorResult {
  const localName = request.callSite.calleeName;
  const bindings = caller.imports?.filter(
    (descriptor) => descriptor.localName === localName,
  );
  if (!bindings || bindings.length !== 1)
    return { status: "abstained", reason: "unresolved-call-binding" };
  const descriptor = bindings[0];
  if (!descriptor || !matchesNamedImportBinding(request, localName))
    return { status: "abstained", reason: "unsupported-call-shape" };
  if (descriptor.viaReexport || descriptor.isCombinedDefaultImport)
    return { status: "abstained", reason: "unsupported-call-shape" };
  if (descriptor.originalName === "*" || descriptor.isTypeOnly)
    return { status: "abstained", reason: "unsupported-call-shape" };
  return { status: "ready", descriptor };
}

function matchesNamedImportBinding(
  request: CallResolutionHypothesisRequest,
  localName: string,
): boolean {
  const binding = request.callSite.calleeBinding;
  return binding?.kind === "import" && binding.name === localName;
}

type AstImportDescriptorResult =
  | {
      readonly status: "ready";
      readonly descriptor: NonNullable<
        CallResolutionHypothesisSourceFile["imports"]
      >[number];
    }
  | {
      readonly status: "abstained";
      readonly reason: AbstentionReason;
    };

export function proveUniqueReexportedNamedImport(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  truncated: boolean,
): CallResolutionStrictProof | null {
  if (!isNamedImportRequest(request)) return null;
  const importTrace = prepareNamedImportTrace(request, workspace, truncated);
  if (importTrace.status === "abstained") return abstain(importTrace.reason);
  const { descriptor, caller, dependencies } = importTrace;
  const targetPath = resolveModulePath(
    request.callerFilePath,
    descriptor.modulePath,
    workspace,
  );
  if (!targetPath) return abstain("unsupported-call-shape");
  addConfiguredPathDependency(descriptor.modulePath, {
    workspace,
    dependencies,
  });
  const trace = traceExport(targetPath, descriptor.originalName, 0, new Set(), {
    workspace,
    dependencies,
  });
  return proofFromTrace(trace, dependencies, workspace);
}

interface NamedImportTraceInput {
  readonly status: "ready";
  readonly caller: CallResolutionHypothesisSourceFile;
  readonly descriptor: NonNullable<
    CallResolutionHypothesisSourceFile["imports"]
  >[number];
  readonly dependencies: Map<string, string>;
}

type NamedImportTracePreparation =
  | NamedImportTraceInput
  | { readonly status: "abstained"; readonly reason: AbstentionReason };

function namedImportPreflightReason(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  truncated: boolean,
): AbstentionReason | null {
  const sourceReason = sourceSnapshotAbstentionReason(request, workspace);
  if (sourceReason) return sourceReason;
  if (!hasOneIndexedCallSite(request, workspace))
    return "call-site-not-in-indexed-source";
  if (
    !workspace.namedFunctionInventoryComplete ||
    workspace.duplicateSourcePaths
  )
    return "incomplete-inventory";
  if (truncated) return "candidate-list-truncated";
  return null;
}

function prepareNamedImportTrace(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  truncated: boolean,
): NamedImportTracePreparation {
  const preflightReason = namedImportPreflightReason(
    request,
    workspace,
    truncated,
  );
  if (preflightReason) return { status: "abstained", reason: preflightReason };

  const caller = workspace.sourceFilesByPath.get(request.callerFilePath);
  if (!caller || !HASH_PATTERN.test(caller.sourceContentHash ?? ""))
    return { status: "abstained", reason: "source-snapshot-unbound" };
  if (!caller.imports)
    return { status: "abstained", reason: "incomplete-inventory" };
  const importResult = importDescriptorForRequest(request, caller);
  if (importResult.status === "abstained") return importResult;
  if (!isSupportedImportPath(importResult.descriptor.modulePath))
    return { status: "abstained", reason: "unsupported-call-shape" };

  const dependencies = new Map<string, string>([
    [request.callerFilePath, caller.sourceContentHash!],
  ]);
  return {
    status: "ready",
    caller,
    descriptor: importResult.descriptor,
    dependencies,
  };
}

function proofFromTrace(
  trace: TraceOutcome,
  dependencies: Map<string, string>,
  workspace: IndexedWorkspace,
): CallResolutionStrictProof | null {
  if (trace.status === "abstained") return abstain(trace.reason);
  if (trace.status === "not-found") {
    return trace.sawReexport ? abstain("unresolved-call-binding") : null;
  }
  if (trace.target.hops === 0) return null;
  if (
    !uniqueFinalCandidate(
      workspace,
      trace.target.filePath,
      trace.target.declaration,
      trace.target.targetKey,
    )
  )
    return abstain("no-unique-owner-candidate");

  return {
    status: "proven",
    targetKey: trace.target.targetKey,
    ruleSignature: CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE,
    reason: "unique-named-import",
    targetFilePath: trace.target.filePath,
    targetName: trace.target.targetName,
    dependencies: [...dependencies]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, contentHash]) => ({ filePath, contentHash })),
  };
}
