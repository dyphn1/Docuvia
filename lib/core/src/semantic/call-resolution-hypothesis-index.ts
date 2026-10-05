import type {
  AstImportDescriptor,
  AstCallSiteShapeFact,
  AstDeclaredDeclaration,
  AstDeclaredTypeFact,
  AstDeclaredTypeFacts,
  AstDeclaredTypeOwner,
  CallResolutionConfiguredPathAliases,
  CallResolutionHypothesisCandidate,
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisWorkspaceIndex,
  CallResolutionHypothesisWorkspaceInput,
} from "@workspace/contracts";
import path from "node:path";
import {
  AST_CALL_SITE_SHAPE_SCHEMA_VERSION,
  AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
} from "@workspace/contracts";
import {
  CandidateWithoutRank,
  HASH_PATTERN,
  deepFreeze,
  hash,
  validateWorkspaceInput,
} from "./call-resolution-hypothesis-internal.js";

const Q1_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export interface IndexedWorkspace {
  readonly handle: CallResolutionHypothesisWorkspaceIndex;
  readonly complete: boolean;
  /** Completeness of the source-bound program-level declaration set used by Q1. */
  readonly namedFunctionInventoryComplete: boolean;
  readonly candidatesByMember: ReadonlyMap<
    string,
    readonly CandidateWithoutRank[]
  >;
  readonly directImportAliasCandidatesByCallerFile: ReadonlyMap<
    string,
    ReadonlyMap<string, readonly CandidateWithoutRank[]>
  >;
  readonly memberNamesByTargetKey: ReadonlyMap<string, ReadonlySet<string>>;
  readonly declarationsByFile: ReadonlyMap<
    string,
    readonly AstDeclaredDeclaration[]
  >;
  readonly factsByFile: ReadonlyMap<string, readonly AstDeclaredTypeFact[]>;
  readonly sourceContentHashByFile: ReadonlyMap<string, string>;
  readonly sourceFilesByPath: ReadonlyMap<
    string,
    CallResolutionHypothesisWorkspaceInput["sourceFiles"][number]
  >;
  readonly configuredPathAliases?: CallResolutionConfiguredPathAliases;
  readonly callSiteShapesByFile: ReadonlyMap<
    string,
    readonly AstCallSiteShapeFact[]
  >;
  readonly duplicateSourcePaths: boolean;
}

interface MutableCandidate {
  filePath: string;
  owner: AstDeclaredTypeOwner;
  memberName: string;
  isStatic: boolean;
  declarations: AstDeclaredDeclaration[];
  sourceLanguage: AstDeclaredTypeFacts["language"];
  inventoryComplete: boolean;
  targetKey: string;
}

interface WorkspaceBuilder {
  complete: boolean;
  namedFunctionInventoryComplete: boolean;
  duplicateSourcePaths: boolean;
  readonly seenPaths: Set<string>;
  readonly candidates: Map<string, MutableCandidate>;
  readonly memberNames: Map<string, Set<string>>;
  readonly declarationsByFile: Map<string, readonly AstDeclaredDeclaration[]>;
  readonly factsByFile: Map<string, readonly AstDeclaredTypeFact[]>;
  readonly sourceContentHashByFile: Map<string, string>;
  readonly callSiteShapesByFile: Map<string, readonly AstCallSiteShapeFact[]>;
}

function ownerKey(owner: AstDeclaredTypeOwner): string {
  return `${owner.kind}:${owner.span.start}:${owner.span.end}:${owner.name ?? ""}`;
}

function ownerMembersKey(
  filePath: string,
  owner: AstDeclaredTypeOwner,
  isStatic: boolean,
): string {
  return `${filePath}#${ownerKey(owner)}#${Number(isStatic)}`;
}

function targetKey(
  filePath: string,
  owner: AstDeclaredTypeOwner,
  memberName: string,
  isStatic: boolean,
  individualDeclarationSpan?: { start: number; end: number },
): string {
  if (individualDeclarationSpan)
    return `${filePath}#function:${individualDeclarationSpan.start}:${individualDeclarationSpan.end}#${memberName}`;
  return `${filePath}#${ownerKey(owner)}#${memberName}#${Number(isStatic)}`;
}

function inventoryIsComplete(
  facts: AstDeclaredTypeFacts,
  owner: AstDeclaredTypeOwner,
): boolean {
  return (
    facts.ownerInventories.find(
      (inventory) => ownerKey(inventory.owner) === ownerKey(owner),
    )?.complete ?? false
  );
}

function supportedDeclaration(declaration: AstDeclaredDeclaration): boolean {
  return (
    declaration.name !== null &&
    ["class", "interface", "object"].includes(declaration.owner.kind) &&
    ["field", "method", "getter", "setter", "unknown"].includes(
      declaration.kind,
    )
  );
}

function memberNameIndexKey(
  filePath: string,
  declaration: AstDeclaredDeclaration,
): string {
  return ownerMembersKey(filePath, declaration.owner, declaration.isStatic);
}

function isBareFunctionCandidate(declaration: AstDeclaredDeclaration): boolean {
  return (
    ["program", "function"].includes(declaration.owner.kind) &&
    declaration.kind === "function"
  );
}

function isNamedProgramArrowCandidate(
  declaration: AstDeclaredDeclaration,
): boolean {
  return (
    declaration.owner.kind === "program" &&
    declaration.kind === "arrow" &&
    !declaration.unsupportedReason
  );
}

function candidateIdentity(declaration: AstDeclaredDeclaration): {
  readonly isStatic: boolean;
  readonly individualDeclarationSpan?: {
    readonly start: number;
    readonly end: number;
  };
} | null {
  if (supportedDeclaration(declaration))
    return { isStatic: declaration.isStatic };
  if (isBareFunctionCandidate(declaration))
    return {
      isStatic: false,
      individualDeclarationSpan: declaration.declarationSpan,
    };
  if (isNamedProgramArrowCandidate(declaration))
    return {
      isStatic: false,
      individualDeclarationSpan: declaration.declarationSpan,
    };
  return null;
}

export function candidateTargetKeyForDeclaration(
  filePath: string,
  declaration: AstDeclaredDeclaration,
): string | undefined {
  const name = declaration.name;
  if (!name) return undefined;
  const identity = candidateIdentity(declaration);
  if (!identity) return undefined;
  return targetKey(
    filePath,
    declaration.owner,
    name,
    identity.isStatic,
    identity.individualDeclarationSpan,
  );
}

function indexOwnerMemberNames(
  builder: WorkspaceBuilder,
  filePath: string,
  facts: AstDeclaredTypeFacts,
): void {
  for (const declaration of facts.declarations) {
    if (!supportedDeclaration(declaration) || !declaration.name) continue;
    const key = memberNameIndexKey(filePath, declaration);
    const names = builder.memberNames.get(key) ?? new Set<string>();
    names.add(declaration.name);
    builder.memberNames.set(key, names);
  }
}

function candidateFactsAreSupported(
  facts: AstDeclaredTypeFacts,
  declaration: AstDeclaredDeclaration,
): boolean {
  if (declaration.owner.kind !== "program" || declaration.kind !== "arrow")
    return true;
  return (
    facts.schemaVersion === AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION &&
    ["typescript", "tsx", "javascript"].includes(facts.language) &&
    !declaration.unsupportedReason
  );
}

function addCandidate(
  builder: WorkspaceBuilder,
  sourceFilePath: string,
  facts: AstDeclaredTypeFacts,
  declaration: AstDeclaredDeclaration,
): void {
  if (!candidateFactsAreSupported(facts, declaration)) return;
  const key = candidateTargetKeyForDeclaration(sourceFilePath, declaration);
  if (!key || !declaration.name) return;
  const isMember = supportedDeclaration(declaration);
  const inventoryComplete =
    !isMember || inventoryIsComplete(facts, declaration.owner);
  const existing = builder.candidates.get(key);
  if (existing) {
    existing.declarations.push(declaration);
    existing.inventoryComplete &&= inventoryComplete;
    return;
  }
  builder.candidates.set(key, {
    filePath: sourceFilePath,
    owner: declaration.owner,
    memberName: declaration.name,
    isStatic: isMember && declaration.isStatic,
    declarations: [declaration],
    sourceLanguage: facts.language,
    inventoryComplete,
    targetKey: key,
  });
}

function indexDeclarations(
  builder: WorkspaceBuilder,
  filePath: string,
  facts: AstDeclaredTypeFacts,
): void {
  indexOwnerMemberNames(builder, filePath, facts);
  for (const declaration of facts.declarations)
    addCandidate(builder, filePath, facts, declaration);
}

function generalInventoryIsIncomplete(facts: AstDeclaredTypeFacts): boolean {
  return (
    facts.schemaVersion !== AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION ||
    !["typescript", "tsx", "javascript"].includes(facts.language) ||
    facts.ownerInventories.some((inventory) => !inventory.complete)
  );
}

function namedFunctionInventoryIsIncomplete(
  source: CallResolutionHypothesisWorkspaceInput["sourceFiles"][number],
  facts: AstDeclaredTypeFacts,
): boolean {
  return (
    hasQ1SourceFactsExtension(source.filePath) &&
    (!source.sourceContentHash ||
      !HASH_PATTERN.test(source.sourceContentHash) ||
      facts.schemaVersion !== AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION ||
      !["typescript", "tsx", "javascript"].includes(facts.language) ||
      facts.declarations.some(
        ({ kind, owner, unsupportedReason }) =>
          owner.kind === "program" &&
          (kind === "unknown" || unsupportedReason !== undefined),
      ))
  );
}

function indexSourceFile(
  builder: WorkspaceBuilder,
  source: CallResolutionHypothesisWorkspaceInput["sourceFiles"][number],
): void {
  if (builder.seenPaths.has(source.filePath)) {
    builder.complete = false;
    builder.namedFunctionInventoryComplete = false;
    builder.duplicateSourcePaths = true;
    return;
  }
  builder.seenPaths.add(source.filePath);
  if (source.sourceContentHash)
    builder.sourceContentHashByFile.set(
      source.filePath,
      source.sourceContentHash,
    );
  if (
    source.callSiteShapeFacts?.schemaVersion ===
      AST_CALL_SITE_SHAPE_SCHEMA_VERSION &&
    Array.isArray(source.callSiteShapeFacts.callSites)
  )
    builder.callSiteShapesByFile.set(
      source.filePath,
      source.callSiteShapeFacts.callSites,
    );
  const facts = source.declaredTypeFacts;
  if (!facts) {
    builder.complete = false;
    if (hasQ1SourceFactsExtension(source.filePath))
      builder.namedFunctionInventoryComplete = false;
    builder.factsByFile.set(source.filePath, []);
    return;
  }
  builder.factsByFile.set(source.filePath, facts.facts);
  builder.declarationsByFile.set(source.filePath, facts.declarations);
  if (generalInventoryIsIncomplete(facts)) builder.complete = false;
  if (namedFunctionInventoryIsIncomplete(source, facts))
    builder.namedFunctionInventoryComplete = false;
  indexDeclarations(builder, source.filePath, facts);
}

function freezeCandidate(candidate: MutableCandidate): CandidateWithoutRank {
  candidate.declarations.sort(
    (left, right) =>
      left.declarationSpan.start - right.declarationSpan.start ||
      left.declarationSpan.end - right.declarationSpan.end,
  );
  return deepFreeze({
    targetKey: candidate.targetKey,
    filePath: candidate.filePath,
    owner: candidate.owner,
    memberName: candidate.memberName,
    isStatic: candidate.isStatic,
    declarationSpans: candidate.declarations.map(
      ({ declarationSpan }) => declarationSpan,
    ),
    declarations: candidate.declarations,
    sourceLanguage: candidate.sourceLanguage,
    inventoryComplete: candidate.inventoryComplete,
  });
}

function sortedCandidates(builder: WorkspaceBuilder): CandidateWithoutRank[] {
  const candidates = [...builder.candidates.values()].map(freezeCandidate);
  for (const candidate of candidates) {
    if (!candidate.inventoryComplete) {
      builder.complete = false;
      if (candidate.owner.kind === "program")
        builder.namedFunctionInventoryComplete = false;
    }
  }
  return candidates.sort(
    (left, right) =>
      left.memberName.localeCompare(right.memberName) ||
      left.filePath.localeCompare(right.filePath) ||
      left.owner.span.start - right.owner.span.start ||
      Number(left.isStatic) - Number(right.isStatic) ||
      left.targetKey.localeCompare(right.targetKey),
  );
}

function candidateMemberMap(
  candidates: readonly CandidateWithoutRank[],
): Map<string, CandidateWithoutRank[]> {
  const result = new Map<string, CandidateWithoutRank[]>();
  for (const candidate of candidates) {
    const list = result.get(candidate.memberName) ?? [];
    list.push(candidate);
    result.set(candidate.memberName, list);
  }
  for (const list of result.values()) deepFreeze(list);
  return result;
}

function normalizedWorkspacePath(filePath: string): string {
  return path.posix.normalize(filePath.replace(/\\/g, "/"));
}

function hasQ1SourceFactsExtension(filePath: string): boolean {
  return Q1_SOURCE_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase());
}

function relativeImportPathCandidates(
  callerFilePath: string,
  modulePath: string,
  includeDirectoryIndexCandidates = false,
): readonly string[] {
  if (!isSupportedRelativeImport(callerFilePath, modulePath)) return [];
  const callerPath = normalizedWorkspacePath(callerFilePath);
  const normalized = path.posix.normalize(
    path.posix.join(path.posix.dirname(callerPath), modulePath),
  );
  if (normalized === ".." || normalized.startsWith("../")) return [];
  return pathCandidatesForNormalizedImport(
    normalized,
    includeDirectoryIndexCandidates,
  );
}

function isSupportedRelativeImport(
  callerFilePath: string,
  modulePath: string,
): boolean {
  return (
    !path.posix.isAbsolute(callerFilePath) &&
    (modulePath.startsWith("./") || modulePath.startsWith("../")) &&
    modulePath.indexOf(String.fromCharCode(92)) === -1 &&
    !modulePath.includes("%") &&
    !modulePath.includes("?") &&
    !modulePath.includes("#")
  );
}

function pathCandidatesForNormalizedImport(
  normalized: string,
  includeDirectoryIndexCandidates = false,
): readonly string[] {
  const extension = path.posix.extname(normalized);
  if (!extension) {
    const candidates = [
      `${normalized}.ts`,
      `${normalized}.tsx`,
      `${normalized}.js`,
      `${normalized}.jsx`,
    ];
    if (includeDirectoryIndexCandidates)
      candidates.push(
        `${normalized}/index.ts`,
        `${normalized}/index.tsx`,
        `${normalized}/index.js`,
        `${normalized}/index.jsx`,
      );
    return candidates;
  }
  if (extension === ".js")
    return [
      normalized,
      `${normalized.slice(0, -3)}.ts`,
      `${normalized.slice(0, -3)}.tsx`,
    ];
  if (extension === ".jsx")
    return [normalized, `${normalized.slice(0, -4)}.tsx`];
  if (extension === ".mjs")
    return [normalized, `${normalized.slice(0, -4)}.mts`];
  if (extension === ".cjs")
    return [normalized, `${normalized.slice(0, -4)}.cts`];
  return [normalized];
}

/** Resolve one syntax-local relative import to exactly one indexed source path. */
export function resolveDirectRelativeImportPath(
  callerFilePath: string,
  modulePath: string,
  availableFilePaths: readonly string[],
  includeDirectoryIndexCandidates = false,
): string | undefined {
  return resolveUniqueImportPath(
    relativeImportPathCandidates(
      callerFilePath,
      modulePath,
      includeDirectoryIndexCandidates,
    ),
    availableFilePaths,
  );
}

export function isWorkspaceBoundSourcePath(filePath: string): boolean {
  return (
    !!filePath &&
    !path.posix.isAbsolute(filePath) &&
    !/^[a-zA-Z]:[\\/]/u.test(filePath) &&
    !filePath.includes("\\") &&
    path.posix.normalize(filePath) === filePath &&
    !filePath.split("/").some((part) => part === ".." || part === ".")
  );
}

/** Resolve the explicitly supported root-local mapping without guessing module semantics. */
export function resolveDirectConfiguredImportPath(
  callerFilePath: string,
  modulePath: string,
  availableFilePaths: readonly string[],
  evidence?: CallResolutionConfiguredPathAliases,
  includeDirectoryIndexCandidates = false,
): string | undefined {
  if (
    !evidence ||
    !isSupportedConfiguredMapping(evidence) ||
    !isSupportedConfiguredSpecifier(callerFilePath, modulePath)
  )
    return undefined;
  return resolveUniqueImportPath(
    pathCandidatesForNormalizedImport(
      "src/" + modulePath.slice(2),
      includeDirectoryIndexCandidates,
    ),
    availableFilePaths,
  );
}

function isSupportedConfiguredMapping(
  evidence: CallResolutionConfiguredPathAliases,
): boolean {
  return !(
    evidence.configurationFilePath !== "tsconfig.json" ||
    !HASH_PATTERN.test(evidence.sourceContentHash) ||
    evidence.baseUrl !== null ||
    evidence.extends.length !== 0 ||
    Object.keys(evidence.paths).length !== 1 ||
    evidence.paths["@/*"]?.length !== 1 ||
    evidence.paths["@/*"]?.[0] !== "./src/*"
  );
}

function isSupportedConfiguredSpecifier(
  callerFilePath: string,
  modulePath: string,
): boolean {
  return !(
    path.posix.isAbsolute(callerFilePath) ||
    !modulePath.startsWith("@/") ||
    modulePath.length <= 2 ||
    /[\\%?#]/.test(modulePath) ||
    modulePath.split("/").some((part) => part === "." || part === ".." || !part)
  );
}

function resolveUniqueImportPath(
  candidates: readonly string[],
  availableFilePaths: readonly string[],
): string | undefined {
  const availableByPath = new Map<string, string[]>();
  for (const filePath of availableFilePaths) {
    const key = normalizedWorkspacePath(filePath);
    const paths = availableByPath.get(key) ?? [];
    paths.push(filePath);
    availableByPath.set(key, paths);
  }
  const matchingPaths = new Set<string>();
  for (const candidate of candidates) {
    const matches = availableByPath.get(candidate) ?? [];
    if (matches.length > 1) return undefined;
    const [match] = matches;
    if (match) matchingPaths.add(match);
  }
  return matchingPaths.size === 1 ? [...matchingPaths][0] : undefined;
}

function isSupportedImportedCallable(candidate: CandidateWithoutRank): boolean {
  const [declaration] = candidate.declarations;
  return (
    candidate.owner.kind === "program" &&
    candidate.declarations.length === 1 &&
    declaration !== undefined &&
    (declaration.kind === "function" || declaration.kind === "arrow") &&
    declaration.owner.kind === "program" &&
    declaration.name === candidate.memberName &&
    !declaration.unsupportedReason
  );
}

function directImportAliasCandidateMap(
  sourceFiles: CallResolutionHypothesisWorkspaceInput["sourceFiles"],
  candidates: readonly CandidateWithoutRank[],
  duplicateSourcePaths: boolean,
  configuredPathAliases?: CallResolutionConfiguredPathAliases,
): ReadonlyMap<string, ReadonlyMap<string, readonly CandidateWithoutRank[]>> {
  if (duplicateSourcePaths) return new Map();
  const sourceByPath = new Map(
    sourceFiles.map((source) => [source.filePath, source]),
  );
  const candidatesByFileAndName = indexImportableCandidates(candidates);
  const result = new Map<
    string,
    Map<string, readonly CandidateWithoutRank[]>
  >();
  const availableFilePaths = sourceFiles.map(({ filePath }) => filePath);
  for (const caller of sourceFiles) {
    const aliases = directImportAliasesForCaller(
      caller,
      sourceByPath,
      availableFilePaths,
      candidatesByFileAndName,
      configuredPathAliases,
    );
    if (aliases.size > 0) result.set(caller.filePath, aliases);
  }
  return result;
}

type AliasSourceFile =
  CallResolutionHypothesisWorkspaceInput["sourceFiles"][number];

function indexImportableCandidates(
  candidates: readonly CandidateWithoutRank[],
): Map<string, CandidateWithoutRank[]> {
  const candidatesByFileAndName = new Map<string, CandidateWithoutRank[]>();
  for (const candidate of candidates) {
    if (!isSupportedImportedCallable(candidate)) continue;
    const key = candidate.filePath + "\0" + candidate.memberName;
    const matches = candidatesByFileAndName.get(key) ?? [];
    matches.push(candidate);
    candidatesByFileAndName.set(key, matches);
  }
  return candidatesByFileAndName;
}

function directImportAliasesForCaller(
  caller: AliasSourceFile,
  sourceByPath: ReadonlyMap<string, AliasSourceFile>,
  availableFilePaths: readonly string[],
  candidatesByFileAndName: ReadonlyMap<string, readonly CandidateWithoutRank[]>,
  configuredPathAliases?: CallResolutionConfiguredPathAliases,
): Map<string, readonly CandidateWithoutRank[]> {
  const result = new Map<string, readonly CandidateWithoutRank[]>();
  if (!caller.imports || !HASH_PATTERN.test(caller.sourceContentHash ?? ""))
    return result;
  const importsByLocalName = groupImportsByLocalName(caller.imports);
  for (const [localName, descriptors] of importsByLocalName) {
    const candidate = resolveImportedAliasCandidate(
      caller,
      descriptors,
      sourceByPath,
      availableFilePaths,
      candidatesByFileAndName,
      configuredPathAliases,
    );
    if (candidate) result.set(localName, [candidate]);
  }
  return result;
}

function groupImportsByLocalName(
  imports: readonly AstImportDescriptor[],
): Map<string, AstImportDescriptor[]> {
  const importsByLocalName = new Map<string, AstImportDescriptor[]>();
  for (const descriptor of imports) {
    const descriptors = importsByLocalName.get(descriptor.localName) ?? [];
    descriptors.push(descriptor);
    importsByLocalName.set(descriptor.localName, descriptors);
  }
  return importsByLocalName;
}

function resolveImportedAliasCandidate(
  caller: AliasSourceFile,
  descriptors: readonly AstImportDescriptor[],
  sourceByPath: ReadonlyMap<string, AliasSourceFile>,
  availableFilePaths: readonly string[],
  candidatesByFileAndName: ReadonlyMap<string, readonly CandidateWithoutRank[]>,
  configuredPathAliases?: CallResolutionConfiguredPathAliases,
): CandidateWithoutRank | undefined {
  if (descriptors.length !== 1) return undefined;
  const [descriptor] = descriptors;
  if (!descriptor || !isSupportedAliasDescriptor(descriptor)) return undefined;
  if (
    descriptor.isCombinedDefaultImport &&
    !isWorkspaceBoundSourcePath(caller.filePath)
  )
    return undefined;
  const relativeTargetPath = resolveDirectRelativeImportPath(
    caller.filePath,
    descriptor.modulePath,
    availableFilePaths,
  );
  const targetPath =
    relativeTargetPath ??
    resolveDirectConfiguredImportPath(
      caller.filePath,
      descriptor.modulePath,
      availableFilePaths,
      configuredPathAliases,
    );
  if (!targetPath) return undefined;
  return uniqueImportedCandidate(
    targetPath,
    descriptor.originalName,
    sourceByPath,
    candidatesByFileAndName,
    relativeTargetPath !== undefined,
  );
}

function uniqueImportedCandidate(
  targetPath: string,
  importedName: string,
  sourceByPath: ReadonlyMap<string, AliasSourceFile>,
  candidatesByFileAndName: ReadonlyMap<string, readonly CandidateWithoutRank[]>,
  relativeImport: boolean,
): CandidateWithoutRank | undefined {
  const target = sourceByPath.get(targetPath);
  if (!target || !isHashBoundExportSource(target)) return undefined;
  if (importedName === "default")
    return isWorkspaceBoundSourcePath(targetPath)
      ? uniqueDirectDefaultFunctionCandidate(
          targetPath,
          target,
          candidatesByFileAndName,
        )
      : undefined;
  return uniqueNamedImportedCandidate(
    targetPath,
    importedName,
    target,
    candidatesByFileAndName,
    relativeImport,
  );
}

function uniqueNamedImportedCandidate(
  targetPath: string,
  importedName: string,
  target: AliasSourceFile,
  candidatesByFileAndName: ReadonlyMap<string, readonly CandidateWithoutRank[]>,
  relativeImport: boolean,
): CandidateWithoutRank | undefined {
  if (!hasUniqueDirectExport(target, importedName)) return undefined;
  const candidates =
    candidatesByFileAndName.get(targetPath + "\0" + importedName) ?? [];
  const [candidate] = candidates;
  if (candidates.length !== 1 || !candidate) return undefined;
  if (
    !relativeImport &&
    !isUniqueConfiguredFunction(candidate, target, importedName)
  )
    return undefined;
  return candidate;
}

function uniqueDirectDefaultFunctionCandidate(
  targetPath: string,
  target: AliasSourceFile,
  candidatesByFileAndName: ReadonlyMap<string, readonly CandidateWithoutRank[]>,
): CandidateWithoutRank | undefined {
  const directDefault = directDefaultFunction(target);
  if (!directDefault) return undefined;
  if (directDefault.declaration.name)
    return namedDefaultFunctionCandidate(
      targetPath,
      directDefault,
      candidatesByFileAndName,
    );
  return anonymousDefaultFunctionCandidate(targetPath, directDefault);
}

interface DirectDefaultFunction {
  readonly declaration: AstDeclaredDeclaration;
  readonly declarationSpan: { readonly start: number; readonly end: number };
  readonly facts: AstDeclaredTypeFacts;
}

function directDefaultFunction(
  target: AliasSourceFile,
): DirectDefaultFunction | undefined {
  const declarationSpan = directDefaultFunctionSpan(target.exports);
  const facts = target.declaredTypeFacts;
  if (!declarationSpan || !facts) return undefined;

  const declarations = facts.declarations.filter((declaration) =>
    matchesDirectDefaultFunction(declaration, declarationSpan),
  );
  const [declaration] = declarations;
  if (declarations.length !== 1 || !declaration) return undefined;
  return {
    declaration,
    declarationSpan,
    facts,
  };
}

function directDefaultFunctionSpan(
  exports: AliasSourceFile["exports"],
): { readonly start: number; readonly end: number } | undefined {
  const defaults = exports?.filter(({ name }) => name === "default");
  if (defaults?.length !== 1) return undefined;
  const [descriptor] = defaults;
  return descriptor?.type === "function"
    ? descriptor.declarationSpan
    : undefined;
}

function matchesDirectDefaultFunction(
  declaration: AstDeclaredDeclaration,
  declarationSpan: { readonly start: number; readonly end: number },
): boolean {
  return (
    declaration.owner.kind === "program" &&
    isSupportedDefaultFunctionDeclaration(declaration) &&
    declaration.declarationSpan.start === declarationSpan.start &&
    declaration.declarationSpan.end === declarationSpan.end
  );
}

function isSupportedDefaultFunctionDeclaration(
  declaration: AstDeclaredDeclaration,
): boolean {
  return (
    (declaration.kind === "function" ||
      declaration.kind === "function-expression") &&
    !declaration.unsupportedReason
  );
}

function namedDefaultFunctionCandidate(
  targetPath: string,
  directDefault: DirectDefaultFunction,
  candidatesByFileAndName: ReadonlyMap<string, readonly CandidateWithoutRank[]>,
): CandidateWithoutRank | undefined {
  const name = directDefault.declaration.name;
  if (!name) return undefined;
  const candidates = (
    candidatesByFileAndName.get(targetPath + "\0" + name) ?? []
  ).filter(
    (candidate) =>
      candidate.owner.kind === "program" &&
      candidate.declarations.length === 1 &&
      candidate.declarations[0]?.declarationSpan.start ===
        directDefault.declarationSpan.start &&
      candidate.declarations[0]?.declarationSpan.end ===
        directDefault.declarationSpan.end,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function anonymousDefaultFunctionCandidate(
  targetPath: string,
  directDefault: DirectDefaultFunction,
): CandidateWithoutRank {
  const { declaration, declarationSpan, facts } = directDefault;
  return deepFreeze({
    targetKey: targetKey(
      targetPath,
      declaration.owner,
      "default",
      false,
      declarationSpan,
    ),
    filePath: targetPath,
    owner: declaration.owner,
    memberName: "default",
    isStatic: false,
    declarationSpans: [declaration.declarationSpan],
    declarations: [declaration],
    sourceLanguage: facts.language,
    inventoryComplete: true,
  });
}

function isUniqueConfiguredFunction(
  candidate: CandidateWithoutRank,
  target: AliasSourceFile,
  importedName: string,
): boolean {
  const exports = target.exports?.filter(({ name }) => name === importedName);
  return (
    importedName !== "default" &&
    candidate.declarations[0]?.kind === "function" &&
    exports?.length === 1 &&
    exports[0]?.type === "function"
  );
}

function isSupportedAliasDescriptor(descriptor: AstImportDescriptor): boolean {
  return (
    !descriptor.viaReexport &&
    !descriptor.isTypeOnly &&
    descriptor.originalName !== "*" &&
    (descriptor.originalName !== "default"
      ? !descriptor.isCombinedDefaultImport
      : descriptor.isCombinedDefaultImport === true) &&
    descriptor.localName !== descriptor.originalName
  );
}

function isHashBoundExportSource(source: AliasSourceFile): boolean {
  return (
    HASH_PATTERN.test(source.sourceContentHash ?? "") &&
    source.exports !== undefined
  );
}

function hasUniqueDirectExport(
  source: AliasSourceFile,
  exportedName: string,
): boolean {
  const matches = source.exports?.filter(
    ({ name, type }) =>
      name === exportedName && (type === "function" || type === "variable"),
  );
  return matches?.length === 1;
}

function workspaceBuilder(
  input: CallResolutionHypothesisWorkspaceInput,
): WorkspaceBuilder {
  return {
    complete: input.sourceIndexComplete && input.sourceFiles.length > 0,
    namedFunctionInventoryComplete:
      input.sourceIndexComplete && input.sourceFiles.length > 0,
    duplicateSourcePaths: false,
    seenPaths: new Set(),
    candidates: new Map(),
    memberNames: new Map(),
    declarationsByFile: new Map(),
    factsByFile: new Map(),
    sourceContentHashByFile: new Map(),
    callSiteShapesByFile: new Map(),
  };
}

export function createIndexedWorkspace(
  input: CallResolutionHypothesisWorkspaceInput,
  configurationHash: string,
): IndexedWorkspace {
  validateWorkspaceInput(input);
  const sourceFiles = deepFreeze(structuredClone(input.sourceFiles));
  const configuredPathAliases =
    input.configuredPathAliases === undefined
      ? undefined
      : deepFreeze(structuredClone(input.configuredPathAliases));
  const boundSourceFingerprint = hash({
    manifestFingerprint: input.sourceFingerprint,
    sourceFiles,
    ...(configuredPathAliases === undefined ? {} : { configuredPathAliases }),
  });
  const builder = workspaceBuilder(input);
  for (const source of sourceFiles) indexSourceFile(builder, source);
  const candidates = sortedCandidates(builder);
  const candidatesByMember = candidateMemberMap(candidates);
  const directImportAliasCandidatesByCallerFile = directImportAliasCandidateMap(
    sourceFiles,
    candidates,
    builder.duplicateSourcePaths,
    configuredPathAliases,
  );
  const handle = Object.freeze({
    schemaVersion: CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
    sourceFingerprint: boundSourceFingerprint,
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    configurationHash,
  }) satisfies CallResolutionHypothesisWorkspaceIndex;
  const memberNamesByTargetKey = new Map<string, ReadonlySet<string>>();
  for (const candidate of candidates) {
    const key = ownerMembersKey(
      candidate.filePath,
      candidate.owner,
      candidate.isStatic,
    );
    memberNamesByTargetKey.set(
      candidate.targetKey,
      builder.memberNames.get(key) ?? new Set<string>(),
    );
  }
  return Object.freeze({
    handle,
    complete: builder.complete,
    namedFunctionInventoryComplete: builder.namedFunctionInventoryComplete,
    candidatesByMember,
    directImportAliasCandidatesByCallerFile,
    memberNamesByTargetKey,
    declarationsByFile: builder.declarationsByFile,
    factsByFile: builder.factsByFile,
    sourceContentHashByFile: builder.sourceContentHashByFile,
    sourceFilesByPath: new Map(
      sourceFiles.map((source) => [source.filePath, source]),
    ),
    ...(configuredPathAliases === undefined ? {} : { configuredPathAliases }),
    callSiteShapesByFile: builder.callSiteShapesByFile,
    duplicateSourcePaths: builder.duplicateSourcePaths,
  });
}

export function getReceiverTypeFact(
  workspace: IndexedWorkspace,
  request: CallResolutionHypothesisRequest,
): AstDeclaredTypeFact | undefined {
  const binding = request.callSite.receiverBinding;
  if (!binding) return undefined;
  return workspace.factsByFile
    .get(request.callerFilePath)
    ?.find(
      (fact) =>
        fact.declarationSpan.start === binding.declarationSpan.start &&
        fact.declarationSpan.end === binding.declarationSpan.end &&
        [
          "field-annotation",
          "parameter-annotation",
          "parameter-property",
          "variable-annotation",
          "new-initializer",
        ].includes(fact.kind),
    );
}

export function candidateMatchesReceiver(
  candidate: CandidateWithoutRank,
  factsForCandidateFile: readonly AstDeclaredTypeFact[],
  receiverTypeName: string,
): boolean {
  if (candidate.owner.name === receiverTypeName) return true;
  return factsForCandidateFile.some(
    (fact) =>
      fact.owner.name === candidate.owner.name &&
      fact.owner.kind === candidate.owner.kind &&
      fact.owner.span.start === candidate.owner.span.start &&
      fact.owner.span.end === candidate.owner.span.end &&
      (fact.kind === "extends" || fact.kind === "implements") &&
      fact.typeName === receiverTypeName,
  );
}

function argumentCountBucket(count: number | null): string {
  if (count === null) return "unknown";
  if (count <= 2) return String(count);
  return "3plus";
}

function peerCountBucket(count: number): string {
  if (count === 0) return "none";
  if (count === 1) return "one";
  return "multiple";
}

function candidateCountBucket(count: number): string {
  if (count <= 1) return String(count);
  if (count === 2) return "2";
  return "3plus";
}

export function createRuleSignature(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  candidates: readonly CandidateWithoutRank[],
  receiverFact: AstDeclaredTypeFact | undefined,
  configurationHash: string,
): string {
  const pattern = {
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    callShape: request.callSite.calleeKind,
    receiverBindingKind: request.callSite.receiverBinding?.kind ?? "none",
    receiverFactKind: receiverFact?.kind ?? "none",
    hasCallerType: request.callSite.callerType !== null,
    hasPeerEvidence: request.callSite.peerMemberNames.length > 0,
    peerCount: peerCountBucket(request.callSite.peerMemberNames.length),
    argumentCount: argumentCountBucket(request.callSite.argumentCount),
    hasSpreadArgument: request.callSite.hasSpreadArgument,
    argumentKinds: request.callSite.argumentKinds,
    candidateCount: candidateCountBucket(candidates.length),
    candidateOwnerKinds: [
      ...new Set(candidates.map(({ owner }) => owner.kind)),
    ].sort(),
    candidateLanguages: [
      ...new Set(candidates.map(({ sourceLanguage }) => sourceLanguage)),
    ].sort(),
    candidateDispatchKinds: [
      ...new Set(
        candidates.map(
          ({ owner, sourceLanguage, isStatic }) =>
            `${owner.kind}:${sourceLanguage}:${isStatic ? "static" : "instance"}`,
        ),
      ),
    ].sort(),
    candidateSetComplete: workspace.complete,
  };
  return hash({ configurationHash, pattern });
}

export function hashFeatureInput(
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  candidates: readonly CallResolutionHypothesisCandidate[],
  receiverFact: AstDeclaredTypeFact | undefined,
): string {
  return hash({
    sourceFingerprint: workspace.handle.sourceFingerprint,
    callerFilePath: request.callerFilePath,
    callSite: request.callSite,
    receiverTypeFact: receiverFact ?? null,
    candidateSetComplete: workspace.complete,
    duplicateSourcePaths: workspace.duplicateSourcePaths,
    candidates: candidates.map((candidate) => ({
      targetKey: candidate.targetKey,
      filePath: candidate.filePath,
      owner: candidate.owner,
      memberName: candidate.memberName,
      isStatic: candidate.isStatic,
      inventoryComplete: candidate.inventoryComplete,
      declarations: candidate.declarations.map((declaration) => ({
        kind: declaration.kind,
        name: declaration.name,
        declarationSpan: declaration.declarationSpan,
        visibility: declaration.visibility,
        isStatic: declaration.isStatic,
        isOptional: declaration.isOptional,
        arity: declaration.arity,
        unsupportedReason: declaration.unsupportedReason ?? null,
      })),
    })),
  });
}
