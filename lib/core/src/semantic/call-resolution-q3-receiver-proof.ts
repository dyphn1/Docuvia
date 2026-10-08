import type {
  AstDeclaredDeclaration,
  AstDeclaredTypeOwner,
  AstQ3ClassDeclarationFact,
  CallResolutionHypothesisCandidate,
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisSourceFile,
  CallResolutionStrictProof,
  CallResolutionStrictProofReason,
} from "@workspace/contracts";
import {
  AST_Q3_RECEIVER_FACTS_SCHEMA_VERSION,
  CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE,
  CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE,
} from "@workspace/contracts";
import {
  candidateTargetKeyForDeclaration,
  getReceiverTypeFact,
  isWorkspaceBoundSourcePath,
  resolveDirectConfiguredImportPath,
  resolveDirectRelativeImportPath,
  type IndexedWorkspace,
} from "./call-resolution-hypothesis-index.js";
import { HASH_PATTERN, hash } from "./call-resolution-hypothesis-internal.js";

const MAX_TYPE_TRACE_DEPTH = 16;
const MAX_EXTENDS_DEPTH = 16;
const SIMPLE_TYPE_NAME = /^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u;
interface ProofContext {
  readonly workspace: IndexedWorkspace;
  readonly dependencies: Map<string, string>;
  readonly consultedCandidateMemberNames: Set<string>;
}

interface ClassReference {
  readonly filePath: string;
  readonly name: string;
  readonly owner: AstDeclaredTypeOwner;
  readonly scopeSpan: { readonly start: number; readonly end: number };
}

function sortedConsultedCandidateMemberNames(context: ProofContext): string[] {
  return [...context.consultedCandidateMemberNames].sort();
}

interface SourceBoundClassFact {
  readonly source: CallResolutionHypothesisSourceFile;
  readonly fact: AstQ3ClassDeclarationFact;
  readonly owner: AstDeclaredTypeOwner;
}

type MemberLookup =
  | {
      readonly status: "found";
      readonly candidate: Pick<CallResolutionHypothesisCandidate, "targetKey">;
    }
  | { readonly status: "absent" }
  | { readonly status: "abstained" };

function abstain(
  reason: Exclude<
    CallResolutionStrictProofReason,
    | "unique-this-owner-member"
    | "unique-named-import"
    | "unique-super-base-member"
    | "unique-inherited-this-member"
    | "unique-typed-receiver-member"
    | "unique-new-receiver-member"
  >,
): CallResolutionStrictProof {
  return { status: "abstained", targetKey: null, ruleSignature: null, reason };
}

function sameSpan(
  left: { readonly start: number; readonly end: number },
  right: { readonly start: number; readonly end: number },
): boolean {
  return left.start === right.start && left.end === right.end;
}

function spanContains(
  outer: { readonly start: number; readonly end: number },
  inner: { readonly start: number; readonly end: number },
): boolean {
  return outer.start <= inner.start && outer.end >= inner.end;
}

function sourceSnapshotReason(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): "source-snapshot-unbound" | "source-snapshot-mismatch" | null {
  const indexedHash = workspace.sourceContentHashByFile.get(
    request.callerFilePath,
  );
  if (!indexedHash || !request.callerSourceContentHash)
    return "source-snapshot-unbound";
  return indexedHash === request.callerSourceContentHash
    ? null
    : "source-snapshot-mismatch";
}

function hasOneIndexedCallSite(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): boolean {
  const callSites = workspace.callSiteShapesByFile.get(request.callerFilePath);
  if (!callSites) return false;
  const requested = hash(request.callSite);
  return (
    callSites.filter((callSite) => hash(callSite) === requested).length === 1
  );
}

function q3PreconditionAbstention(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  truncated: boolean,
): CallResolutionStrictProof | null {
  if (workspace.duplicateSourcePaths) return abstain("incomplete-inventory");
  if (truncated) return abstain("candidate-list-truncated");
  if (!isWorkspaceBoundSourcePath(request.callerFilePath))
    return abstain("unsupported-call-shape");
  const sourceReason = sourceSnapshotReason(request, workspace);
  if (sourceReason) return abstain(sourceReason);
  if (!hasOneIndexedCallSite(request, workspace))
    return abstain("call-site-not-in-indexed-source");
  if (request.callSite.receiverOptional !== false)
    return abstain("unsupported-call-shape");
  return null;
}

function sourceFor(
  filePath: string,
  context: ProofContext,
): CallResolutionHypothesisSourceFile | null {
  if (!isWorkspaceBoundSourcePath(filePath)) return null;
  const source = context.workspace.sourceFilesByPath.get(filePath);
  if (
    !source ||
    !HASH_PATTERN.test(source.sourceContentHash ?? "") ||
    !source.declaredTypeFacts
  )
    return null;
  context.dependencies.set(filePath, source.sourceContentHash as string);
  return source;
}

function ownerForClassFact(
  source: SourceBoundClassFact["source"],
  fact: AstQ3ClassDeclarationFact,
): AstDeclaredTypeOwner | null {
  const inventories = source.declaredTypeFacts?.ownerInventories.filter(
    ({ owner }) =>
      owner.kind === fact.kind &&
      owner.name === fact.name &&
      sameSpan(owner.span, fact.declarationSpan),
  );
  const inventory = inventories?.[0];
  return inventories?.length === 1 && inventory?.complete
    ? inventory.owner
    : null;
}

function classReference(
  filePath: string,
  source: SourceBoundClassFact["source"],
  fact: AstQ3ClassDeclarationFact,
): ClassReference | null {
  if (fact.kind !== "class" || fact.genericTypeParameterNames.length > 0)
    return null;
  const owner = ownerForClassFact(source, fact);
  return owner
    ? { filePath, name: fact.name, owner, scopeSpan: fact.scopeSpan }
    : null;
}

function addConfigurationDependency(
  modulePath: string,
  context: ProofContext,
): void {
  const aliases = context.workspace.configuredPathAliases;
  if (modulePath.startsWith("@/") && aliases) {
    context.dependencies.set(
      aliases.configurationFilePath,
      aliases.sourceContentHash,
    );
  }
}

function resolveModulePath(
  callerFilePath: string,
  modulePath: string,
  context: ProofContext,
): string | null {
  const availablePaths = [...context.workspace.sourceFilesByPath.keys()];
  const targetPath =
    modulePath.startsWith("./") || modulePath.startsWith("../")
      ? resolveDirectRelativeImportPath(
          callerFilePath,
          modulePath,
          availablePaths,
          true,
        )
      : modulePath.startsWith("@/")
        ? (addConfigurationDependency(modulePath, context),
          resolveDirectConfiguredImportPath(
            callerFilePath,
            modulePath,
            availablePaths,
            context.workspace.configuredPathAliases,
            true,
          ))
        : undefined;
  return targetPath && isWorkspaceBoundSourcePath(targetPath)
    ? targetPath
    : null;
}

function importedTypeDescriptor(
  source: SourceBoundClassFact["source"],
  localName: string,
) {
  const imports = source.imports;
  if (!imports) return null;
  const matches = imports.filter(
    ({ localName: importedLocalName }) => importedLocalName === localName,
  );
  const descriptor = matches[0];
  if (
    matches.length !== 1 ||
    !descriptor ||
    descriptor.viaReexport ||
    descriptor.isCombinedDefaultImport ||
    descriptor.originalName === "*" ||
    descriptor.originalName === "default"
  )
    return null;
  const sameExport = imports.filter(
    (candidate) =>
      candidate.modulePath === descriptor.modulePath &&
      candidate.originalName === descriptor.originalName,
  );
  return sameExport.length === 1 ? descriptor : null;
}

function resolutionKey(filePath: string, symbol: string): string {
  return `${filePath}\0${symbol}`;
}

function q3Facts(source: SourceBoundClassFact["source"]) {
  const facts = source.declaredTypeFacts?.q3ReceiverFacts;
  return facts?.schemaVersion === AST_Q3_RECEIVER_FACTS_SCHEMA_VERSION
    ? facts
    : null;
}

type LocalTypeBinding =
  | { readonly kind: "class"; readonly fact: AstQ3ClassDeclarationFact }
  | {
      readonly kind: "alias";
      readonly fact: NonNullable<
        ReturnType<typeof q3Facts>
      >["typeAliases"][number];
    }
  | {
      readonly kind: "import";
      readonly descriptor: NonNullable<
        ReturnType<typeof importedTypeDescriptor>
      >;
    };

function localTypeBinding(
  source: SourceBoundClassFact["source"],
  facts: NonNullable<ReturnType<typeof q3Facts>>,
  typeName: string,
  useScope: { readonly start: number; readonly end: number } | null,
): LocalTypeBinding | null {
  const visibleInScope = (scopeSpan: {
    readonly start: number;
    readonly end: number;
  }) => (useScope ? spanContains(scopeSpan, useScope) : scopeSpan.start === 0);
  const classes = facts.classes.filter(
    (fact) => fact.name === typeName && visibleInScope(fact.scopeSpan),
  );
  const aliases = facts.typeAliases.filter(
    (fact) => fact.name === typeName && visibleInScope(fact.scopeSpan),
  );
  const imports =
    source.imports?.filter(({ localName }) => localName === typeName) ?? [];
  if (classes.length + aliases.length + imports.length !== 1) return null;

  const classFact = classes[0];
  if (classFact) return { kind: "class", fact: classFact };
  const alias = aliases[0];
  if (alias) return { kind: "alias", fact: alias };
  const descriptor = importedTypeDescriptor(source, typeName);
  return descriptor ? { kind: "import", descriptor } : null;
}

function resolveAliasBinding(
  filePath: string,
  alias: Extract<LocalTypeBinding, { readonly kind: "alias" }>["fact"],
  context: ProofContext,
  visited: ReadonlySet<string>,
  depth: number,
): ClassReference | null {
  if (alias.genericTypeParameterNames.length > 0) return null;
  return resolveClassName(
    filePath,
    alias.typeName,
    alias.scopeSpan,
    context,
    visited,
    depth + 1,
  );
}

function resolveImportedBinding(
  filePath: string,
  descriptor: Extract<
    LocalTypeBinding,
    { readonly kind: "import" }
  >["descriptor"],
  context: ProofContext,
  visited: ReadonlySet<string>,
  depth: number,
): ClassReference | null {
  const targetPath = resolveModulePath(
    filePath,
    descriptor.modulePath,
    context,
  );
  return targetPath
    ? resolveExportedClass(
        targetPath,
        descriptor.originalName,
        context,
        visited,
        depth + 1,
      )
    : null;
}

function resolveTypeBinding(
  filePath: string,
  source: SourceBoundClassFact["source"],
  binding: LocalTypeBinding,
  context: ProofContext,
  visited: ReadonlySet<string>,
  depth: number,
): ClassReference | null {
  if (binding.kind === "class")
    return classReference(filePath, source, binding.fact);
  if (binding.kind === "alias")
    return resolveAliasBinding(filePath, binding.fact, context, visited, depth);
  return resolveImportedBinding(
    filePath,
    binding.descriptor,
    context,
    visited,
    depth,
  );
}

function resolveClassName(
  filePath: string,
  typeName: string,
  useScope: { readonly start: number; readonly end: number } | null,
  context: ProofContext,
  visited: ReadonlySet<string>,
  depth = 0,
): ClassReference | null {
  if (
    depth >= MAX_TYPE_TRACE_DEPTH ||
    !SIMPLE_TYPE_NAME.test(typeName) ||
    visited.has(resolutionKey(filePath, typeName))
  )
    return null;
  const source = sourceFor(filePath, context);
  const facts = source && q3Facts(source);
  if (!source || !facts) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(resolutionKey(filePath, typeName));
  const binding = localTypeBinding(source, facts, typeName, useScope);
  return binding
    ? resolveTypeBinding(filePath, source, binding, context, nextVisited, depth)
    : null;
}

function resolveDirectExportedClass(
  filePath: string,
  source: SourceBoundClassFact["source"],
  classFact: AstQ3ClassDeclarationFact,
  descriptors: NonNullable<SourceBoundClassFact["source"]["exports"]>,
): ClassReference | null {
  const exportDescriptor = descriptors[0];
  return descriptors.length === 1 &&
    classFact.kind === "class" &&
    exportDescriptor?.type === "class"
    ? classReference(filePath, source, classFact)
    : null;
}

function resolveDirectExportedAlias(
  filePath: string,
  alias: NonNullable<ReturnType<typeof q3Facts>>["typeAliases"][number],
  descriptors: NonNullable<SourceBoundClassFact["source"]["exports"]>,
  context: ProofContext,
  visited: ReadonlySet<string>,
  depth: number,
): ClassReference | null {
  const exportDescriptor = descriptors[0];
  const aliasIsExported = descriptors.length === 0 && !alias.isExported;
  if (
    alias.genericTypeParameterNames.length > 0 ||
    exportDescriptor?.type === "class" ||
    aliasIsExported ||
    descriptors.length > 1
  )
    return null;
  return resolveClassName(
    filePath,
    alias.typeName,
    alias.scopeSpan,
    context,
    visited,
    depth + 1,
  );
}

function directExportedClass(
  filePath: string,
  exportedName: string,
  source: SourceBoundClassFact["source"],
  facts: NonNullable<ReturnType<typeof q3Facts>>,
  descriptors: NonNullable<SourceBoundClassFact["source"]["exports"]>,
  context: ProofContext,
  visited: ReadonlySet<string>,
  depth: number,
): { readonly matched: boolean; readonly classRef: ClassReference | null } {
  const topLevelScope = (scope: { readonly start: number }) =>
    scope.start === 0;
  const directClasses = facts.classes.filter(
    (fact) => fact.name === exportedName && topLevelScope(fact.scopeSpan),
  );
  const directAliases = facts.typeAliases.filter(
    (fact) => fact.name === exportedName && topLevelScope(fact.scopeSpan),
  );
  const directClass = directClasses[0];
  const directAlias = directAliases[0];

  if (directClasses.length + directAliases.length > 1)
    return { matched: true, classRef: null };
  if (directClass)
    return {
      matched: true,
      classRef: resolveDirectExportedClass(
        filePath,
        source,
        directClass,
        descriptors,
      ),
    };
  if (!directAlias) return { matched: false, classRef: null };

  return {
    matched: true,
    classRef: resolveDirectExportedAlias(
      filePath,
      directAlias,
      descriptors,
      context,
      visited,
      depth,
    ),
  };
}

function resolveExportedReexport(
  filePath: string,
  exportedName: string,
  source: SourceBoundClassFact["source"],
  context: ProofContext,
  visited: ReadonlySet<string>,
  depth: number,
): ClassReference | null {
  const reexports = source.reexports?.filter(
    (reexport) =>
      reexport.exportedName === exportedName &&
      (reexport.kind === "named" || reexport.kind === "local"),
  );
  const reexport = reexports?.[0];
  if (!reexports || reexports.length !== 1 || !reexport) return null;
  if (reexport.kind === "local")
    return resolveClassName(
      filePath,
      reexport.localName,
      null,
      context,
      visited,
      depth + 1,
    );
  if (reexport.kind !== "named") return null;
  const targetPath = resolveModulePath(filePath, reexport.modulePath, context);
  return targetPath
    ? resolveExportedClass(
        targetPath,
        reexport.importedName,
        context,
        visited,
        depth + 1,
      )
    : null;
}

function resolveExportedClass(
  filePath: string,
  exportedName: string,
  context: ProofContext,
  visited: ReadonlySet<string>,
  depth: number,
): ClassReference | null {
  if (
    depth >= MAX_TYPE_TRACE_DEPTH ||
    visited.has(resolutionKey(filePath, exportedName))
  )
    return null;
  const source = sourceFor(filePath, context);
  const facts = source && q3Facts(source);
  if (!source || !facts) return null;
  const nextVisited = new Set(visited);
  nextVisited.add(resolutionKey(filePath, exportedName));
  const descriptors =
    source.exports?.filter(({ name }) => name === exportedName) ?? [];
  const direct = directExportedClass(
    filePath,
    exportedName,
    source,
    facts,
    descriptors,
    context,
    nextVisited,
    depth,
  );
  return direct.matched
    ? direct.classRef
    : resolveExportedReexport(
        filePath,
        exportedName,
        source,
        context,
        nextVisited,
        depth,
      );
}

function classFromCallerType(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  context: ProofContext,
): ClassReference | null {
  const callerType = request.callSite.callerType;
  if (!callerType) return null;
  const source = sourceFor(request.callerFilePath, context);
  const facts = source && q3Facts(source);
  const classFacts = facts?.classes.filter(
    (fact) =>
      fact.kind === "class" &&
      fact.name === callerType.name &&
      sameSpan(fact.declarationSpan, callerType.span),
  );
  const fact = classFacts?.[0];
  return classFacts?.length === 1 && source && fact
    ? classReference(request.callerFilePath, source, fact)
    : null;
}

function hasEnclosingInstanceMethod(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  classOwner: AstDeclaredTypeOwner,
): boolean {
  const declarations = workspace.declarationsByFile.get(request.callerFilePath);
  if (!declarations) return false;
  const matches = declarations.filter(
    (declaration) =>
      declaration.kind === "method" &&
      declaration.owner.kind === "class" &&
      declaration.owner.name === classOwner.name &&
      sameSpan(declaration.owner.span, classOwner.span) &&
      !declaration.isStatic &&
      spanContains(
        declaration.declarationSpan,
        request.callSite.lexicalScopeSpan,
      ),
  );
  return matches.length === 1;
}

function directBaseClass(
  classRef: ClassReference,
  context: ProofContext,
  visited: ReadonlySet<string>,
): ClassReference | null {
  const source = sourceFor(classRef.filePath, context);
  const facts = source?.declaredTypeFacts;
  if (!source || !facts) return null;
  const baseFacts = facts.facts.filter(
    (fact) =>
      fact.kind === "extends" &&
      fact.owner.kind === "class" &&
      fact.owner.name === classRef.owner.name &&
      sameSpan(fact.owner.span, classRef.owner.span),
  );
  const baseFact = baseFacts[0];
  if (baseFacts.length !== 1 || !baseFact) return null;
  return resolveClassName(
    classRef.filePath,
    baseFact.typeName,
    classRef.scopeSpan,
    context,
    visited,
  );
}

function isSameOwner(
  declaration: AstDeclaredDeclaration,
  owner: AstDeclaredTypeOwner,
): boolean {
  return (
    declaration.owner.kind === "class" &&
    declaration.owner.name === owner.name &&
    sameSpan(declaration.owner.span, owner.span)
  );
}

function hasCompleteClassInventory(
  facts: NonNullable<SourceBoundClassFact["source"]["declaredTypeFacts"]>,
  classRef: ClassReference,
): boolean {
  const inventories = facts.ownerInventories.filter(
    ({ owner }) =>
      owner.kind === "class" &&
      owner.name === classRef.owner.name &&
      sameSpan(owner.span, classRef.owner.span),
  );
  return inventories.length === 1 && inventories[0]?.complete === true;
}

type MemberDeclaration =
  | { readonly status: "absent" }
  | { readonly status: "abstained" }
  | { readonly status: "found"; readonly declaration: AstDeclaredDeclaration };

function findMemberDeclaration(
  facts: NonNullable<SourceBoundClassFact["source"]["declaredTypeFacts"]>,
  classRef: ClassReference,
  memberName: string,
): MemberDeclaration {
  const declarations = facts.declarations.filter(
    (declaration) =>
      isSameOwner(declaration, classRef.owner) &&
      declaration.name === memberName,
  );
  if (declarations.length === 0) return { status: "absent" };
  const declaration = declarations[0];
  if (
    declarations.length !== 1 ||
    !declaration ||
    declaration.kind !== "method" ||
    declaration.isStatic ||
    declaration.isAbstract ||
    declaration.unsupportedReason
  )
    return { status: "abstained" };
  return { status: "found", declaration };
}

function candidateMatchesDeclaration(
  candidate: Pick<
    CallResolutionHypothesisCandidate,
    "declarations" | "targetKey"
  >,
  classRef: ClassReference,
  declaration: AstDeclaredDeclaration,
): boolean {
  return (
    candidate.declarations.length === 1 &&
    candidate.declarations[0]?.declarationSpan.start ===
      declaration.declarationSpan.start &&
    candidate.declarations[0]?.declarationSpan.end ===
      declaration.declarationSpan.end &&
    candidate.targetKey ===
      candidateTargetKeyForDeclaration(classRef.filePath, declaration)
  );
}

function candidateForMemberDeclaration(
  classRef: ClassReference,
  memberName: string,
  declaration: AstDeclaredDeclaration,
  context: ProofContext,
): Pick<CallResolutionHypothesisCandidate, "targetKey"> | null {
  context.consultedCandidateMemberNames.add(memberName);
  const candidates = (
    context.workspace.candidatesByMember.get(memberName) ?? []
  ).filter(
    (candidate) =>
      candidate.filePath === classRef.filePath &&
      candidate.owner.kind === "class" &&
      candidate.owner.name === classRef.owner.name &&
      sameSpan(candidate.owner.span, classRef.owner.span) &&
      candidate.memberName === memberName &&
      !candidate.isStatic,
  );
  const candidate = candidates[0];
  if (
    candidates.length !== 1 ||
    !candidate ||
    !candidate.inventoryComplete ||
    !candidateMatchesDeclaration(candidate, classRef, declaration)
  )
    return null;
  return candidate;
}

function lookupMember(
  classRef: ClassReference,
  memberName: string,
  context: ProofContext,
): MemberLookup {
  const source = sourceFor(classRef.filePath, context);
  const facts = source?.declaredTypeFacts;
  if (!source || !facts || !hasCompleteClassInventory(facts, classRef))
    return { status: "abstained" };
  const member = findMemberDeclaration(facts, classRef, memberName);
  if (member.status === "absent") return { status: "absent" };
  if (member.status !== "found") return { status: "abstained" };
  const candidate = candidateForMemberDeclaration(
    classRef,
    memberName,
    member.declaration,
    context,
  );
  if (!candidate) return { status: "abstained" };
  return { status: "found", candidate };
}

function lookupInExtendsChain(
  start: ClassReference,
  memberName: string,
  context: ProofContext,
  includeStart: boolean,
): {
  readonly classRef: ClassReference;
  readonly candidate: Pick<CallResolutionHypothesisCandidate, "targetKey">;
} | null {
  let classRef = start;
  let depth = 0;
  const visitedClasses = new Set<string>();
  const visitedTypes = new Set<string>();
  while (depth <= MAX_EXTENDS_DEPTH) {
    const classKey = `${classRef.filePath}\0${classRef.owner.span.start}:${classRef.owner.span.end}`;
    if (visitedClasses.has(classKey)) return null;
    visitedClasses.add(classKey);
    if (includeStart || depth > 0) {
      const lookup = lookupMember(classRef, memberName, context);
      if (lookup.status === "found")
        return { classRef, candidate: lookup.candidate };
      if (lookup.status === "abstained") return null;
    }
    if (depth === MAX_EXTENDS_DEPTH) return null;
    const base = directBaseClass(classRef, context, visitedTypes);
    if (!base) return null;
    classRef = base;
    depth += 1;
  }
  return null;
}

function dependencyRows(
  dependencies: ReadonlyMap<string, string>,
): { filePath: string; contentHash: string }[] {
  return [...dependencies]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, contentHash]) => ({ filePath, contentHash }));
}

type Q3RuleSignature =
  | typeof CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE
  | typeof CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE
  | typeof CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE
  | typeof CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE;
type Q3ProofReason =
  | "unique-super-base-member"
  | "unique-inherited-this-member"
  | "unique-typed-receiver-member"
  | "unique-new-receiver-member";

function proven(
  candidate: Pick<CallResolutionHypothesisCandidate, "targetKey">,
  classRef: ClassReference,
  ruleSignature: Q3RuleSignature,
  reason: Q3ProofReason,
  memberName: string,
  context: ProofContext,
): CallResolutionStrictProof {
  return {
    status: "proven",
    targetKey: candidate.targetKey,
    ruleSignature,
    reason,
    targetFilePath: classRef.filePath,
    targetName: memberName,
    targetOwnerName: classRef.name,
    dependencies: dependencyRows(context.dependencies),
    consultedCandidateMemberNames: sortedConsultedCandidateMemberNames(context),
  } as CallResolutionStrictProof;
}

function proveTypedOrNewReceiver(
  request: CallResolutionHypothesisRequest,
  context: ProofContext,
  receiverTypeName: string,
  ruleSignature: Q3RuleSignature,
  reason: Q3ProofReason,
): CallResolutionStrictProof {
  const classRef = resolveClassName(
    request.callerFilePath,
    receiverTypeName,
    request.callSite.lexicalScopeSpan,
    context,
    new Set(),
  );
  if (!classRef) return abstain("unresolved-type-binding");
  const found = lookupInExtendsChain(
    classRef,
    request.callSite.calleeName,
    context,
    true,
  );
  return found
    ? proven(
        found.candidate,
        found.classRef,
        ruleSignature,
        reason,
        request.callSite.calleeName,
        context,
      )
    : abstain("no-unique-owner-candidate");
}

function proveTypedReceiver(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  context: ProofContext,
): CallResolutionStrictProof {
  const fact = getReceiverTypeFact(workspace, request);
  if (
    !fact ||
    ![
      "field-annotation",
      "parameter-annotation",
      "parameter-property",
    ].includes(fact.kind) ||
    fact.typeText !== fact.typeName ||
    !SIMPLE_TYPE_NAME.test(fact.typeName)
  )
    return abstain("unresolved-type-binding");
  return proveTypedOrNewReceiver(
    request,
    context,
    fact.typeName,
    CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE,
    "unique-typed-receiver-member",
  );
}

function simpleNewReceiverName(receiverText: string | null): string | null {
  if (!receiverText) return null;
  const match =
    /^\s*new\s+([$\p{ID_Start}_][$\p{ID_Continue}_]*)\s*\(\s*\)\s*$/u.exec(
      receiverText,
    );
  return match?.[1] ?? null;
}

function newReceiverBindingFact(
  request: CallResolutionHypothesisRequest,
  context: ProofContext,
):
  | NonNullable<ReturnType<typeof q3Facts>>["newReceiverBindings"][number]
  | null {
  const binding = request.callSite.receiverBinding;
  if (!binding || binding.kind !== "local") return null;
  const source = sourceFor(request.callerFilePath, context);
  const facts = source && q3Facts(source);
  const matches = facts?.newReceiverBindings.filter(
    (fact) =>
      fact.name === binding.name &&
      sameSpan(fact.declarationSpan, binding.declarationSpan) &&
      sameSpan(fact.scopeSpan, binding.scopeSpan),
  );
  return matches?.length === 1 ? (matches[0] ?? null) : null;
}

function constNewReceiverBindingTypeName(
  request: CallResolutionHypothesisRequest,
  context: ProofContext,
): string | null {
  const fact = newReceiverBindingFact(request, context);
  return fact?.bindingKind === "const" && !fact.isReassigned
    ? fact.typeName
    : null;
}

function newReceiverTypeName(
  request: CallResolutionHypothesisRequest,
  context: ProofContext,
): string | null {
  return (
    simpleNewReceiverName(request.callSite.receiverText) ??
    constNewReceiverBindingTypeName(request, context)
  );
}

function proveSuperCall(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  context: ProofContext,
): CallResolutionStrictProof {
  const classRef = classFromCallerType(request, workspace, context);
  if (
    !classRef ||
    !hasEnclosingInstanceMethod(request, workspace, classRef.owner)
  )
    return abstain("unsupported-call-shape");
  const base = directBaseClass(classRef, context, new Set());
  if (!base) return abstain("unresolved-type-binding");
  const lookup = lookupMember(base, request.callSite.calleeName, context);
  return lookup.status === "found"
    ? proven(
        lookup.candidate,
        base,
        CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE,
        "unique-super-base-member",
        request.callSite.calleeName,
        context,
      )
    : abstain("no-unique-owner-candidate");
}

function proveInheritedThis(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  context: ProofContext,
): CallResolutionStrictProof {
  const binding = request.callSite.receiverBinding;
  const classRef = classFromCallerType(request, workspace, context);
  if (
    !classRef ||
    binding?.kind !== "this" ||
    binding.name !== "this" ||
    !sameSpan(binding.declarationSpan, classRef.owner.span) ||
    !sameSpan(binding.scopeSpan, classRef.owner.span) ||
    !hasEnclosingInstanceMethod(request, workspace, classRef.owner)
  )
    return abstain("unsupported-call-shape");
  const ownMember = lookupMember(
    classRef,
    request.callSite.calleeName,
    context,
  );
  if (ownMember.status !== "absent")
    return abstain("no-unique-owner-candidate");
  const inherited = lookupInExtendsChain(
    classRef,
    request.callSite.calleeName,
    context,
    false,
  );
  return inherited
    ? proven(
        inherited.candidate,
        inherited.classRef,
        CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE,
        "unique-inherited-this-member",
        request.callSite.calleeName,
        context,
      )
    : abstain("no-unique-owner-candidate");
}

type Q3ReceiverKind = "super" | "this-inherited" | "typed" | "new";

function classifyThisReceiver(
  request: CallResolutionHypothesisRequest,
): Q3ReceiverKind | null {
  const callSite = request.callSite;
  if (callSite.calleeKind === "this" && callSite.receiverText === "super")
    return "super";
  if (
    callSite.calleeKind === "this" &&
    callSite.receiverText === "this" &&
    callSite.receiverBinding?.kind === "this"
  )
    return "this-inherited";
  return null;
}

function classifyMemberReceiver(
  request: CallResolutionHypothesisRequest,
): Q3ReceiverKind | null {
  const callSite = request.callSite;
  if (
    callSite.calleeKind === "member" &&
    ["parameter", "field", "parameter-property"].includes(
      callSite.receiverBinding?.kind ?? "",
    )
  )
    return "typed";
  if (
    (callSite.calleeKind === "member" || callSite.calleeKind === "arg-chain") &&
    (simpleNewReceiverName(callSite.receiverText) !== null ||
      callSite.receiverBinding?.kind === "local")
  )
    return "new";
  return null;
}

function classifyQ3Receiver(
  request: CallResolutionHypothesisRequest,
): Q3ReceiverKind | null {
  return classifyThisReceiver(request) ?? classifyMemberReceiver(request);
}

/** Resolves the strict Q3 receiver forms without changing candidate selection or graph projection. */
export function proveUniqueQ3Receiver(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  truncated: boolean,
): CallResolutionStrictProof | null {
  const receiverKind = classifyQ3Receiver(request);
  if (!receiverKind) return null;
  const precondition = q3PreconditionAbstention(request, workspace, truncated);
  if (precondition) return precondition;
  const context: ProofContext = {
    workspace,
    dependencies: new Map(),
    consultedCandidateMemberNames: new Set(),
  };
  const caller = sourceFor(request.callerFilePath, context);
  if (!caller) return abstain("source-snapshot-unbound");

  let proof: CallResolutionStrictProof;
  if (receiverKind === "super") {
    proof = proveSuperCall(request, workspace, context);
  } else if (receiverKind === "this-inherited") {
    proof = proveInheritedThis(request, workspace, context);
  } else if (receiverKind === "typed") {
    proof = proveTypedReceiver(request, workspace, context);
  } else {
    const receiverTypeName = newReceiverTypeName(request, context);
    proof = receiverTypeName
      ? proveTypedOrNewReceiver(
          request,
          context,
          receiverTypeName,
          CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE,
          "unique-new-receiver-member",
        )
      : abstain("unresolved-type-binding");
  }

  const consultedCandidateMemberNames =
    sortedConsultedCandidateMemberNames(context);
  return consultedCandidateMemberNames.length > 0
    ? { ...proof, consultedCandidateMemberNames }
    : proof;
}
