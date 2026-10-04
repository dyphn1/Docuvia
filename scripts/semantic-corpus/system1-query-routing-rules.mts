/**
 * Strict, source-only System-1 routing queries. This module uses the TypeScript
 * compiler API to parse syntax; it does not create a Program or a type checker.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const MAX_REEXPORT_DEPTH = 16;
const DECLARATION_LINE_SUFFIX = /@L\d+$/;
const CALL_SITE_CACHE = new WeakMap<
  ts.SourceFile,
  Map<string, readonly ts.CallExpression[]>
>();
const SOURCE_ENCODING = "utf8";
const JS_TO_TS_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".js",
  ".jsx",
] as const;

export interface System1QueryOption {
  readonly id: string;
  readonly kind: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface System1QueryState {
  readonly request: {
    readonly requestId: string;
    readonly evidence: {
      readonly projectId: string;
    };
    readonly context: { readonly text: string };
    readonly options: readonly System1QueryOption[];
  };
}

export type System1QueryId = "q1" | "q2" | "q3";

/** Exact call-site location supplied out of band from model-visible request context. `column`
 *  uses the canonical AstWorker/corpus and TypeScript UTF-16 code-unit convention. */
export interface System1CallSitePosition {
  readonly line: number;
  readonly column: number;
}

export type System1QueryResult =
  | {
      readonly status: "commit";
      readonly optionId: string;
      readonly targetId: string;
      readonly proof: string;
    }
  | { readonly status: "abstain"; readonly reason: string };

export interface System1QueryResults {
  readonly q1: System1QueryResult;
  readonly q2: System1QueryResult;
  readonly q3: System1QueryResult;
  readonly cascade:
    | {
        readonly status: "commit";
        readonly optionId: string;
        readonly targetId: string;
        readonly winningQueries: readonly System1QueryId[];
      }
    | {
        readonly status: "abstain";
        readonly reason: "no-query-commit" | "query-conflict";
        readonly conflictTargets?: readonly string[];
      };
}

interface QueryContext {
  readonly caller: { readonly filePath: string; readonly symbol: string };
  readonly call: {
    readonly kind: string;
    readonly calleeName: string;
    readonly expression: string;
    readonly genericHints: readonly unknown[];
  };
  readonly importBinding?: {
    readonly local: string;
    readonly imported: string;
    readonly sourceSpecifier: string;
    readonly pathAlias: boolean;
  } | null;
}

interface ParsedModule {
  readonly sourceFile: ts.SourceFile;
  readonly directExports: ReadonlyMap<string, ReadonlySet<string>>;
  readonly reexports: readonly ts.ExportDeclaration[];
}

interface ModuleConfig {
  readonly baseUrl: string;
  readonly paths: Readonly<Record<string, readonly string[]>>;
}

interface ExportTrace {
  readonly targets: ReadonlySet<string>;
  readonly uncertain: boolean;
  readonly reason?: string;
  readonly starSourceCount: number;
}

const abstain = (reason: string): System1QueryResult => ({
  status: "abstain",
  reason,
});

function normalizeRelative(filePath: string): string {
  return filePath.split(path.sep).join("/").replace(/^\.\//, "");
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function readStringLiteral(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteral(node) ? node.text : null;
}

function nameText(
  name: ts.PropertyName | ts.BindingName | undefined,
): string | null {
  if (!name) return null;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  )
    return name.text;
  return null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
  );
}

function addExport(
  exports: Map<string, Set<string>>,
  exportedName: string,
  targetName: string,
): void {
  const names = exports.get(exportedName) ?? new Set<string>();
  names.add(targetName);
  exports.set(exportedName, names);
}

function declaredTargetName(statement: ts.Statement): string | null {
  if (
    ts.isClassDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  )
    return statement.name?.text ?? null;
  return null;
}

function directExports(sourceFile: ts.SourceFile): {
  readonly direct: Map<string, Set<string>>;
  readonly reexports: ts.ExportDeclaration[];
} {
  const direct = new Map<string, Set<string>>();
  const reexports: ts.ExportDeclaration[] = [];
  const declaredLocals = new Set<string>();
  for (const statement of sourceFile.statements) {
    const declared = declaredTargetName(statement);
    if (declared !== null) declaredLocals.add(declared);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const localName = nameText(declaration.name);
        if (localName !== null) declaredLocals.add(localName);
      }
    }
  }
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const specifier = readStringLiteral(statement.moduleSpecifier);
      if (specifier !== null) {
        reexports.push(statement);
        continue;
      }
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const localName = element.propertyName?.text ?? element.name.text;
          if (declaredLocals.has(localName))
            addExport(direct, element.name.text, localName);
        }
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (!statement.isExportEquals) {
        if (
          !ts.isIdentifier(statement.expression) ||
          declaredLocals.has(statement.expression.text)
        ) {
          const target = ts.isIdentifier(statement.expression)
            ? statement.expression.text
            : "default";
          addExport(direct, "default", target);
        }
      }
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    const declared = declaredTargetName(statement);
    if (
      declared === null &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword) &&
      (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement))
    ) {
      addExport(direct, "default", "default");
      continue;
    }
    if (declared !== null) {
      addExport(direct, declared, declared);
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
        addExport(direct, "default", declared);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = nameText(declaration.name);
        if (name !== null) addExport(direct, name, name);
      }
    }
  }
  return { direct, reexports };
}

function hasParseErrors(sourceFile: ts.SourceFile): boolean {
  return sourceFile.parseDiagnostics.length > 0;
}

export class System1QuerySourceIndex {
  private readonly sourceFiles = new Map<string, ts.SourceFile | null>();
  private readonly parsedModules = new Map<string, ParsedModule | null>();
  private readonly configs = new Map<string, ModuleConfig | null>();

  constructor(
    private readonly root: string,
    private readonly trackedFiles: ReadonlySet<string>,
  ) {}

  read(filePath: string): ts.SourceFile | null {
    const normalized = normalizeRelative(filePath);
    const cached = this.sourceFiles.get(normalized);
    if (cached !== undefined) return cached;
    if (!this.trackedFiles.has(normalized)) {
      this.sourceFiles.set(normalized, null);
      return null;
    }
    try {
      const text = readFileSync(
        path.join(this.root, normalized),
        SOURCE_ENCODING,
      );
      const sourceFile = ts.createSourceFile(
        normalized,
        text,
        ts.ScriptTarget.Latest,
        true,
        normalized.endsWith(".tsx") || normalized.endsWith(".jsx")
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS,
      );
      this.sourceFiles.set(normalized, sourceFile);
      return sourceFile;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      this.sourceFiles.set(normalized, null);
      return null;
    }
  }

  parseModule(filePath: string): ParsedModule | null {
    const normalized = normalizeRelative(filePath);
    const cached = this.parsedModules.get(normalized);
    if (cached !== undefined) return cached;
    const sourceFile = this.read(normalized);
    if (!sourceFile || hasParseErrors(sourceFile)) {
      this.parsedModules.set(normalized, null);
      return null;
    }
    const exports = directExports(sourceFile);
    const parsed = {
      sourceFile,
      directExports: exports.direct,
      reexports: exports.reexports,
    };
    this.parsedModules.set(normalized, parsed);
    return parsed;
  }

  resolveModule(
    callerFile: string,
    specifier: string,
    projectId: string,
    usePathAlias: boolean,
  ): string | null {
    const candidateBases: string[] = [];
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      candidateBases.push(
        path.resolve(this.root, path.dirname(callerFile), specifier),
      );
    } else if (specifier.startsWith("/")) {
      candidateBases.push(path.resolve(this.root, `.${specifier}`));
    } else if (usePathAlias) {
      const config = this.moduleConfig(projectId);
      if (!config) return null;
      for (const [pattern, replacements] of Object.entries(config.paths)) {
        const capture = matchPathPattern(pattern, specifier);
        if (capture === null) continue;
        for (const replacement of replacements) {
          const mapped = replacement.replace("*", capture);
          candidateBases.push(path.resolve(config.baseUrl, mapped));
        }
      }
      if (candidateBases.length === 0)
        candidateBases.push(path.resolve(config.baseUrl, specifier));
    } else {
      return null;
    }
    for (const base of candidateBases) {
      const found = this.resolveFileBase(base);
      if (found !== null) return found;
    }
    return null;
  }

  private resolveFileBase(absoluteBase: string): string | null {
    const candidates = new Set<string>();
    const extension = path.extname(absoluteBase);
    if (extension) {
      candidates.add(absoluteBase);
      if (extension === ".js" || extension === ".jsx") {
        const withoutExtension = absoluteBase.slice(0, -extension.length);
        for (const sourceExtension of JS_TO_TS_EXTENSIONS)
          candidates.add(`${withoutExtension}${sourceExtension}`);
      }
    } else {
      candidates.add(absoluteBase);
      for (const sourceExtension of JS_TO_TS_EXTENSIONS)
        candidates.add(`${absoluteBase}${sourceExtension}`);
      for (const sourceExtension of JS_TO_TS_EXTENSIONS)
        candidates.add(path.join(absoluteBase, `index${sourceExtension}`));
    }
    for (const absolute of candidates) {
      const relative = normalizeRelative(path.relative(this.root, absolute));
      if (
        this.trackedFiles.has(relative) &&
        existsSync(path.join(this.root, relative))
      )
        return relative;
    }
    return null;
  }

  private moduleConfig(projectId: string): ModuleConfig | null {
    const configFile = normalizeRelative(projectId);
    const cached = this.configs.get(configFile);
    if (cached !== undefined) return cached;
    const absoluteConfig = path.join(this.root, configFile);
    if (!this.trackedFiles.has(configFile)) {
      this.configs.set(configFile, null);
      return null;
    }
    const readResult = ts.readConfigFile(absoluteConfig, ts.sys.readFile);
    if (readResult.error) {
      this.configs.set(configFile, null);
      return null;
    }
    const host: ts.ParseConfigHost = {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      readDirectory: () => [],
      fileExists: (fileName) => existsSync(fileName),
      readFile: ts.sys.readFile,
    };
    const parsed = ts.parseJsonConfigFileContent(
      readResult.config,
      host,
      path.dirname(absoluteConfig),
      undefined,
      absoluteConfig,
    );
    const baseUrl = parsed.options.baseUrl ?? path.dirname(absoluteConfig);
    const paths = parsed.options.paths ?? {};
    const result = { baseUrl, paths };
    this.configs.set(configFile, result);
    return result;
  }
}

function matchPathPattern(pattern: string, value: string): string | null {
  const starIndex = pattern.indexOf("*");
  if (starIndex < 0) return pattern === value ? "" : null;
  if (pattern.indexOf("*", starIndex + 1) >= 0) return null;
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return null;
  return value.slice(prefix.length, value.length - suffix.length);
}

function parseContext(state: System1QueryState): QueryContext | null {
  try {
    const value: unknown = JSON.parse(state.request.context.text);
    if (!value || typeof value !== "object") return null;
    const context = value as Record<string, unknown>;
    const caller = context.caller as Record<string, unknown> | null;
    const call = context.call as Record<string, unknown> | null;
    if (
      !caller ||
      typeof caller.filePath !== "string" ||
      typeof caller.symbol !== "string" ||
      !call ||
      typeof call.kind !== "string" ||
      typeof call.calleeName !== "string" ||
      typeof call.expression !== "string"
    )
      return null;
    const rawBinding = context.importBinding;
    const binding =
      rawBinding && typeof rawBinding === "object"
        ? (rawBinding as Record<string, unknown>)
        : null;
    if (
      binding &&
      (typeof binding.local !== "string" ||
        typeof binding.imported !== "string" ||
        typeof binding.sourceSpecifier !== "string")
    )
      return null;
    return {
      caller: { filePath: caller.filePath, symbol: caller.symbol },
      call: {
        kind: call.kind,
        calleeName: call.calleeName,
        expression: call.expression,
        genericHints: Array.isArray(call.genericHints) ? call.genericHints : [],
      },
      importBinding: binding
        ? {
            local: binding.local as string,
            imported: binding.imported as string,
            sourceSpecifier: binding.sourceSpecifier as string,
            pathAlias: binding.pathAlias === true,
          }
        : null,
    };
  } catch {
    return null;
  }
}

function candidateOptions(
  state: System1QueryState,
): readonly { readonly optionId: string; readonly targetId: string }[] {
  return state.request.options.flatMap((option) => {
    const targetId = option.attributes?.targetId;
    return option.kind === "candidate" && typeof targetId === "string"
      ? [{ optionId: option.id, targetId }]
      : [];
  });
}

function validateDirectImportCall(
  context: QueryContext,
  source: System1QuerySourceIndex,
  callSitePosition?: System1CallSitePosition,
): { readonly valid: true } | { readonly reason: string } {
  const binding = context.importBinding;
  if (!binding) return { reason: "missing-import-binding" };
  if (context.call.kind !== "bare") return { reason: "call-is-not-bare-kind" };
  if (context.call.calleeName !== binding.local)
    return { reason: "import-binding-is-not-call-callee" };
  const sourceFile = source.read(context.caller.filePath);
  if (!sourceFile || hasParseErrors(sourceFile))
    return { reason: "caller-file-unparseable" };
  const actualBinding = importForLocalName(sourceFile, binding.local);
  if (!actualBinding) return { reason: "import-binding-not-unique-in-caller" };
  if (
    actualBinding.sourceSpecifier !== binding.sourceSpecifier ||
    actualBinding.importedName !== binding.imported
  )
    return { reason: "import-binding-does-not-match-caller-source" };
  const callSite = callSitePosition
    ? findCallSiteAtPosition(sourceFile, callSitePosition)
    : (() => {
        const callSites = findCallSite(sourceFile, context.call.expression);
        return callSites.length === 1 ? callSites[0] : null;
      })();
  if (!callSite)
    return {
      reason: callSitePosition
        ? "callsite-not-at-position"
        : "callsite-not-unique",
    };
  if (
    callSitePosition &&
    compactSyntax(callSite.getText(sourceFile)) !==
      compactSyntax(context.call.expression)
  )
    return { reason: "callsite-context-mismatch" };
  if (
    !ts.isIdentifier(callSite.expression) ||
    callSite.expression.text !== binding.local
  )
    return { reason: "request-callsite-not-direct-import" };
  return { valid: true };
}

function commitTarget(
  state: System1QueryState,
  targetId: string,
  proof: string,
): System1QueryResult {
  const candidates = candidateOptions(state);
  const matches = candidates.filter(
    (candidate) => candidate.targetId === targetId,
  );
  if (matches.length !== 1) return abstain("target-not-unique-in-options");
  // Tier A disambiguates same-named declarations in one file as `base@L<line>` (C-03).
  // A name-built `base` id cannot tell which of them the query proved, so abstain.
  const base = declarationBaseId(targetId);
  if (
    candidates.some(
      (candidate) =>
        candidate.targetId !== targetId &&
        declarationBaseId(candidate.targetId) === base,
    )
  )
    return abstain("same-name-declarations-in-options");
  return {
    status: "commit",
    optionId: matches[0].optionId,
    targetId,
    proof,
  };
}

function declarationBaseId(targetId: string): string {
  return targetId.replace(DECLARATION_LINE_SUFFIX, "");
}

function targetId(filePath: string, symbol: string): string {
  return `${normalizeRelative(filePath)}#${symbol}`;
}

function q1ImportSource(
  state: System1QueryState,
  context: QueryContext,
  source: System1QuerySourceIndex,
  callSitePosition?: System1CallSitePosition,
): System1QueryResult {
  const binding = context.importBinding;
  if (!binding) return abstain("missing-import-binding");
  const validation = validateDirectImportCall(
    context,
    source,
    callSitePosition,
  );
  if (!validation.valid) return abstain(validation.reason);
  const modulePath = source.resolveModule(
    context.caller.filePath,
    binding.sourceSpecifier,
    state.request.evidence.projectId,
    binding.pathAlias,
  );
  if (!modulePath) return abstain("import-source-unresolved");
  const parsed = source.parseModule(modulePath);
  if (!parsed) return abstain("source-module-unparseable");
  const targets = parsed.directExports.get(binding.imported);
  if (!targets || targets.size !== 1)
    return abstain("direct-export-not-unique");
  const [symbol] = targets;
  return commitTarget(
    state,
    targetId(modulePath, symbol),
    "import-source-direct-export",
  );
}

function q2ReexportTrace(
  state: System1QueryState,
  context: QueryContext,
  source: System1QuerySourceIndex,
  callSitePosition?: System1CallSitePosition,
): System1QueryResult {
  const binding = context.importBinding;
  if (!binding) return abstain("missing-import-binding");
  const validation = validateDirectImportCall(
    context,
    source,
    callSitePosition,
  );
  if (!validation.valid) return abstain(validation.reason);
  const modulePath = source.resolveModule(
    context.caller.filePath,
    binding.sourceSpecifier,
    state.request.evidence.projectId,
    binding.pathAlias,
  );
  if (!modulePath) return abstain("import-source-unresolved");
  const rootModule = source.parseModule(modulePath);
  if (!rootModule) return abstain("source-module-unparseable");
  if (rootModule.reexports.length === 0)
    return abstain("source-module-has-no-reexports");
  const trace = traceExport(
    source,
    modulePath,
    binding.imported,
    context.caller.filePath,
    state.request.evidence.projectId,
    binding.pathAlias,
    new Set(),
    0,
  );
  if (trace.uncertain)
    return abstain(trace.reason ?? "uncertain-reexport-trace");
  if (trace.targets.size !== 1) {
    return abstain(
      trace.starSourceCount > 1
        ? "ambiguous-export-star"
        : trace.targets.size > 1
          ? "ambiguous-reexport-target"
          : "reexport-target-not-found",
    );
  }
  const [resolvedTarget] = trace.targets;
  return commitTarget(state, resolvedTarget, "reexport-chain");
}

function traceExport(
  source: System1QuerySourceIndex,
  modulePath: string,
  exportedName: string,
  callerFile: string,
  projectId: string,
  usePathAlias: boolean,
  visited: ReadonlySet<string>,
  depth: number,
): ExportTrace {
  if (depth > MAX_REEXPORT_DEPTH)
    return {
      targets: new Set(),
      uncertain: true,
      reason: "reexport-depth-limit",
      starSourceCount: 0,
    };
  const visitKey = `${modulePath}#${exportedName}`;
  if (visited.has(visitKey))
    return {
      targets: new Set(),
      uncertain: true,
      reason: "reexport-cycle",
      starSourceCount: 0,
    };
  const parsed = source.parseModule(modulePath);
  if (!parsed)
    return {
      targets: new Set(),
      uncertain: true,
      reason: "source-module-unparseable",
      starSourceCount: 0,
    };
  const direct = parsed.directExports.get(exportedName);
  if (direct?.size) {
    return {
      targets: new Set(
        [...direct].map((symbol) => targetId(modulePath, symbol)),
      ),
      uncertain: direct.size > 1,
      reason: direct.size > 1 ? "ambiguous-direct-export" : undefined,
      starSourceCount: 0,
    };
  }
  const nextVisited = new Set(visited).add(visitKey);
  const explicit: ExportTrace[] = [];
  const stars: ExportTrace[] = [];
  for (const declaration of parsed.reexports) {
    const specifier = readStringLiteral(declaration.moduleSpecifier);
    if (specifier === null) continue;
    if (
      declaration.exportClause &&
      ts.isNamedExports(declaration.exportClause)
    ) {
      for (const element of declaration.exportClause.elements) {
        if (element.name.text !== exportedName) continue;
        const imported = element.propertyName?.text ?? element.name.text;
        const resolved = source.resolveModule(
          modulePath,
          specifier,
          projectId,
          usePathAlias,
        );
        explicit.push(
          resolved
            ? traceExport(
                source,
                resolved,
                imported,
                callerFile,
                projectId,
                usePathAlias,
                nextVisited,
                depth + 1,
              )
            : {
                targets: new Set(),
                uncertain: true,
                reason: "reexport-source-unresolved",
                starSourceCount: 0,
              },
        );
      }
      continue;
    }
    if (declaration.exportClause) continue;
    if (exportedName === "default") continue;
    const resolved = source.resolveModule(
      modulePath,
      specifier,
      projectId,
      usePathAlias,
    );
    stars.push(
      resolved
        ? traceExport(
            source,
            resolved,
            exportedName,
            callerFile,
            projectId,
            usePathAlias,
            nextVisited,
            depth + 1,
          )
        : {
            targets: new Set(),
            uncertain: true,
            reason: "reexport-source-unresolved",
            starSourceCount: 0,
          },
    );
  }
  if (explicit.length > 0) return combineTraces(explicit, false);
  const successfulStars = stars.filter(
    (trace) => trace.targets.size > 0 || trace.uncertain,
  );
  if (successfulStars.length > 1) {
    return {
      targets: new Set(successfulStars.flatMap((trace) => [...trace.targets])),
      uncertain: true,
      reason: "ambiguous-export-star",
      starSourceCount: successfulStars.length,
    };
  }
  if (successfulStars.length === 1) {
    const [trace] = successfulStars;
    return { ...trace, starSourceCount: 1 };
  }
  return {
    targets: new Set(),
    uncertain: stars.some((trace) => trace.uncertain),
    reason: stars.find((trace) => trace.uncertain)?.reason,
    starSourceCount: 0,
  };
}

function combineTraces(
  traces: readonly ExportTrace[],
  isStar: boolean,
): ExportTrace {
  const targets = new Set(traces.flatMap((trace) => [...trace.targets]));
  const uncertain = traces.some((trace) => trace.uncertain) || targets.size > 1;
  return {
    targets,
    uncertain,
    reason:
      traces.find((trace) => trace.uncertain)?.reason ??
      (targets.size > 1 ? "ambiguous-reexport-target" : undefined),
    starSourceCount: isStar ? traces.length : 0,
  };
}

interface ClassReference {
  readonly filePath: string;
  readonly className: string;
}

interface ReceiverEvidence {
  readonly classReference: ClassReference;
  readonly staticReceiver: boolean;
  readonly proof: string;
}

function findCallSite(
  sourceFile: ts.SourceFile,
  expressionText: string,
): readonly ts.CallExpression[] {
  const cachedByExpression = CALL_SITE_CACHE.get(sourceFile);
  const expressionCache =
    cachedByExpression ?? new Map<string, readonly ts.CallExpression[]>();
  if (!cachedByExpression) CALL_SITE_CACHE.set(sourceFile, expressionCache);
  const cached = expressionCache.get(expressionText);
  if (cached) return cached;
  const expected = compactSyntax(expressionText);
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      compactSyntax(node.getText(sourceFile)) === expected
    )
      matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  expressionCache.set(expressionText, matches);
  return matches;
}

function findCallSiteAtPosition(
  sourceFile: ts.SourceFile,
  position: System1CallSitePosition,
): ts.CallExpression | null {
  const lineStarts = sourceFile.getLineStarts();
  if (
    !Number.isSafeInteger(position.line) ||
    position.line < 0 ||
    !Number.isSafeInteger(position.column) ||
    position.column < 0 ||
    position.line >= lineStarts.length
  )
    return null;
  const lineStart = lineStarts[position.line];
  const nextLineStart = lineStarts[position.line + 1] ?? sourceFile.text.length;
  const lineText = sourceFile.text
    .slice(lineStart, nextLineStart)
    .replace(/(?:\r\n|\r|\n)$/, "");
  if (position.column > lineText.length) return null;
  let offset: number;
  try {
    offset = sourceFile.getPositionOfLineAndCharacter(
      position.line,
      position.column,
    );
  } catch {
    return null;
  }
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      offset >= node.expression.getStart(sourceFile) &&
      offset < node.expression.getEnd()
    )
      matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  matches.sort((a, b) => a.getWidth(sourceFile) - b.getWidth(sourceFile));
  const smallestWidth = matches[0]?.getWidth(sourceFile);
  const innermost = matches.filter(
    (call) => call.getWidth(sourceFile) === smallestWidth,
  );
  return innermost.length === 1 ? innermost[0] : null;
}

function compactSyntax(value: string): string {
  return value.replace(/\s+/g, "");
}

function isClassInstanceMember(
  node: ts.Node,
): node is
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration {
  return (
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function classForThis(call: ts.CallExpression): {
  readonly classDeclaration: ts.ClassLikeDeclaration;
  readonly staticReceiver: boolean;
} | null {
  let cursor: ts.Node | undefined = call.parent;
  while (cursor) {
    if (ts.isClassLike(cursor))
      return { classDeclaration: cursor, staticReceiver: false };
    if (
      ts.isFunctionLike(cursor) &&
      !ts.isArrowFunction(cursor) &&
      !isClassInstanceMember(cursor)
    )
      return null;
    if (isClassInstanceMember(cursor)) {
      const classDeclaration = findClassAncestor(cursor);
      return classDeclaration
        ? {
            classDeclaration,
            staticReceiver: hasModifier(cursor, ts.SyntaxKind.StaticKeyword),
          }
        : null;
    }
    cursor = cursor.parent;
  }
  return null;
}

function findClassAncestor(node: ts.Node): ts.ClassLikeDeclaration | null {
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (ts.isClassLike(cursor)) return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function enclosingFunction(
  call: ts.CallExpression,
): ts.SignatureDeclaration | null {
  let cursor: ts.Node | undefined = call.parent;
  while (cursor) {
    if (ts.isFunctionLike(cursor)) return cursor as ts.SignatureDeclaration;
    cursor = cursor.parent;
  }
  return null;
}

function classDeclarationByName(
  sourceFile: ts.SourceFile,
  className: string,
): ts.ClassDeclaration | null {
  const matches = sourceFile.statements.filter(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  return matches.length === 1 ? matches[0] : null;
}

function declarationType(
  typeNode: ts.TypeNode | undefined,
): { readonly name: string } | { readonly reason: string } {
  if (
    !typeNode ||
    !ts.isTypeReferenceNode(typeNode) ||
    !ts.isIdentifier(typeNode.typeName) ||
    (typeNode.typeArguments?.length ?? 0) > 0
  )
    return { reason: "unsupported-receiver-type" };
  return { name: typeNode.typeName.text };
}

function importForLocalName(
  sourceFile: ts.SourceFile,
  localName: string,
): { readonly sourceSpecifier: string; readonly importedName: string } | null {
  const matches: {
    readonly sourceSpecifier: string;
    readonly importedName: string;
  }[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const sourceSpecifier = readStringLiteral(statement.moduleSpecifier);
    const clause = statement.importClause;
    if (!sourceSpecifier || !clause) continue;
    if (clause.name?.text === localName)
      matches.push({ sourceSpecifier, importedName: "default" });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      const matching = clause.namedBindings.elements.filter(
        (element) => element.name.text === localName,
      );
      for (const element of matching)
        matches.push({
          sourceSpecifier,
          importedName: element.propertyName?.text ?? element.name.text,
        });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function classTargetForImport(
  sourceFile: ts.SourceFile,
  sourceFilePath: string,
  localName: string,
  projectId: string,
  source: System1QuerySourceIndex,
): { readonly reference: ClassReference } | { readonly reason: string } {
  const binding = importForLocalName(sourceFile, localName);
  if (!binding) return { reason: "receiver-type-not-class" };
  const usePathAlias =
    !binding.sourceSpecifier.startsWith(".") &&
    !path.isAbsolute(binding.sourceSpecifier);
  const modulePath = source.resolveModule(
    sourceFilePath,
    binding.sourceSpecifier,
    projectId,
    usePathAlias,
  );
  if (!modulePath) return { reason: "receiver-type-module-unresolved" };
  const parsed = source.parseModule(modulePath);
  if (!parsed) return { reason: "receiver-type-module-unparseable" };
  const direct = parsed.directExports.get(binding.importedName);
  let targets: ReadonlySet<string> | undefined = direct
    ? new Set([...direct].map((symbol) => targetId(modulePath, symbol)))
    : undefined;
  if (!targets && parsed.reexports.length > 0) {
    const trace = traceExport(
      source,
      modulePath,
      binding.importedName,
      sourceFilePath,
      projectId,
      usePathAlias,
      new Set(),
      0,
    );
    if (trace.uncertain)
      return { reason: trace.reason ?? "uncertain-type-reexport" };
    targets = new Set(trace.targets);
  }
  if (!targets || targets.size !== 1)
    return { reason: "receiver-type-export-not-unique" };
  const [target] = targets;
  const separator = target.lastIndexOf("#");
  const targetFile = target.slice(0, separator);
  const className = target.slice(separator + 1);
  const targetSource = source.read(targetFile);
  if (!targetSource) return { reason: "receiver-type-source-unreadable" };
  const classDeclaration = classDeclarationByName(targetSource, className);
  if (!classDeclaration) {
    const isInterface = targetSource.statements.some(
      (statement) =>
        ts.isInterfaceDeclaration(statement) &&
        statement.name.text === className,
    );
    return {
      reason: isInterface ? "interface-type" : "receiver-type-not-class",
    };
  }
  return { reference: { filePath: targetFile, className } };
}

function classForTypeName(
  sourceFile: ts.SourceFile,
  sourceFilePath: string,
  typeName: string,
  projectId: string,
  source: System1QuerySourceIndex,
): { readonly reference: ClassReference } | { readonly reason: string } {
  const local = classDeclarationByName(sourceFile, typeName);
  if (local)
    return { reference: { filePath: sourceFilePath, className: typeName } };
  const localInterface = sourceFile.statements.some(
    (statement) =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === typeName,
  );
  if (localInterface) return { reason: "interface-type" };
  return classTargetForImport(
    sourceFile,
    sourceFilePath,
    typeName,
    projectId,
    source,
  );
}

function receiverForTypedName(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  sourceFilePath: string,
  projectId: string,
  source: System1QuerySourceIndex,
  proof: string,
): ReceiverEvidence | { readonly reason: string } {
  const type = declarationType(typeNode);
  if (!("name" in type)) return type;
  const resolved = classForTypeName(
    sourceFile,
    sourceFilePath,
    type.name,
    projectId,
    source,
  );
  if (!("reference" in resolved)) return resolved;
  return {
    classReference: resolved.reference,
    staticReceiver: false,
    proof,
  };
}

function propertyTypeOnClass(
  classDeclaration: ts.ClassLikeDeclaration,
  propertyName: string,
  staticReceiver: boolean,
): ts.TypeNode | undefined {
  const matching = classDeclaration.members.filter(
    (member) =>
      ts.isPropertyDeclaration(member) &&
      nameText(member.name) === propertyName,
  );
  const matchingStatic = matching.filter(
    (member) =>
      hasModifier(member, ts.SyntaxKind.StaticKeyword) === staticReceiver,
  );
  if (matchingStatic.length === 1) return matchingStatic[0].type;
  if (matchingStatic.length > 1 || matching.length > 0) return undefined;
  if (staticReceiver) return undefined;
  for (const member of classDeclaration.members) {
    if (!ts.isConstructorDeclaration(member)) continue;
    const parameters = member.parameters.filter(
      (parameter) =>
        nameText(parameter.name) === propertyName &&
        ts.canHaveModifiers(parameter) &&
        (ts
          .getModifiers(parameter)
          ?.some((modifier) =>
            [
              ts.SyntaxKind.PublicKeyword,
              ts.SyntaxKind.ProtectedKeyword,
              ts.SyntaxKind.PrivateKeyword,
              ts.SyntaxKind.ReadonlyKeyword,
            ].includes(modifier.kind),
          ) ??
          false),
    );
    if (parameters.length === 1) return parameters[0].type;
    if (parameters.length > 1) return undefined;
  }
  return undefined;
}

function identifierTypeInFunction(
  name: string,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
):
  | { readonly typeNode: ts.TypeNode; readonly proof: string }
  | { readonly reason: string } {
  const scope = enclosingFunction(call);
  if (scope) {
    const parameters = scope.parameters.filter(
      (parameter) => nameText(parameter.name) === name,
    );
    if (parameters.length === 1) {
      const typeNode = parameters[0].type;
      return typeNode
        ? { typeNode, proof: "receiver-parameter-type" }
        : { reason: "receiver-type-unannotated" };
    }
    if (parameters.length > 1) return { reason: "receiver-binding-ambiguous" };
    const variables: ts.VariableDeclaration[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        enclosingFunction(node) === scope
      )
        variables.push(node);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    const preceding = variables.filter((declaration) => {
      const statement = declaration.parent.parent;
      return (
        declaration.pos < call.pos &&
        ts.isVariableStatement(statement) &&
        ts.isBlock(scope.body) &&
        statement.parent === scope.body
      );
    });
    if (preceding.length === 1) {
      const [declaration] = preceding;
      if (
        ts.isVariableDeclarationList(declaration.parent) &&
        (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
        ts.isNewExpression(declaration.initializer) &&
        ts.isIdentifier(declaration.initializer.expression) &&
        (declaration.initializer.typeArguments?.length ?? 0) === 0
      )
        return {
          typeNode: ts.factory.createTypeReferenceNode(
            declaration.initializer.expression.text,
          ),
          proof: "receiver-const-constructor",
        };
      return { reason: "receiver-binding-not-immutable-and-explicit" };
    }
    if (preceding.length > 1) return { reason: "receiver-binding-ambiguous" };
  }
  const topLevelVariables = sourceFile.statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.filter(
          (declaration) =>
            ts.isIdentifier(declaration.name) && declaration.name.text === name,
        )
      : [],
  );
  if (topLevelVariables.length === 1) {
    const [declaration] = topLevelVariables;
    if (
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      ts.isNewExpression(declaration.initializer) &&
      ts.isIdentifier(declaration.initializer.expression) &&
      (declaration.initializer.typeArguments?.length ?? 0) === 0
    )
      return {
        typeNode: ts.factory.createTypeReferenceNode(
          declaration.initializer.expression.text,
        ),
        proof: "receiver-const-constructor",
      };
  }
  if (topLevelVariables.length > 1)
    return { reason: "receiver-binding-ambiguous" };
  return { reason: "receiver-binding-not-found" };
}

function receiverEvidence(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  sourceFilePath: string,
  projectId: string,
  source: System1QuerySourceIndex,
): ReceiverEvidence | { readonly reason: string } {
  if (!ts.isPropertyAccessExpression(call.expression))
    return { reason: "unsupported-member-call-shape" };
  const receiver = call.expression.expression;
  if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
    const enclosing = classForThis(call);
    if (!enclosing?.classDeclaration.name)
      return { reason: "receiver-enclosing-class-unknown" };
    return {
      classReference: {
        filePath: sourceFilePath,
        className: enclosing.classDeclaration.name.text,
      },
      staticReceiver: enclosing.staticReceiver,
      proof: "receiver-enclosing-class",
    };
  }
  if (
    ts.isPropertyAccessExpression(receiver) &&
    receiver.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    const enclosing = classForThis(call);
    if (!enclosing?.classDeclaration.name)
      return { reason: "receiver-enclosing-class-unknown" };
    const typeNode = propertyTypeOnClass(
      enclosing.classDeclaration,
      receiver.name.text,
      enclosing.staticReceiver,
    );
    if (!typeNode) return { reason: "receiver-field-type-not-explicit" };
    const typed = receiverForTypedName(
      typeNode,
      sourceFile,
      sourceFilePath,
      projectId,
      source,
      "receiver-class-field-type",
    );
    return "classReference" in typed
      ? { ...typed, staticReceiver: enclosing.staticReceiver }
      : typed;
  }
  if (ts.isIdentifier(receiver)) {
    const type = identifierTypeInFunction(receiver.text, call, sourceFile);
    if (!("typeNode" in type)) return type;
    return receiverForTypedName(
      type.typeNode,
      sourceFile,
      sourceFilePath,
      projectId,
      source,
      type.proof,
    );
  }
  return { reason: "unsupported-receiver-expression" };
}

function resolveClassMethod(
  classReference: ClassReference,
  memberName: string,
  staticReceiver: boolean,
  source: System1QuerySourceIndex,
  projectId: string,
  visited: ReadonlySet<string>,
):
  | { readonly targetId: string; readonly inherited: boolean }
  | { readonly reason: string } {
  const key = `${classReference.filePath}#${classReference.className}`;
  if (visited.has(key)) return { reason: "receiver-inheritance-cycle" };
  const sourceFile = source.read(classReference.filePath);
  if (!sourceFile || hasParseErrors(sourceFile))
    return { reason: "receiver-class-unparseable" };
  const classDeclaration = classDeclarationByName(
    sourceFile,
    classReference.className,
  );
  if (!classDeclaration) return { reason: "receiver-class-not-found" };
  const methods = classDeclaration.members.filter(
    (member) =>
      ts.isMethodDeclaration(member) &&
      nameText(member.name) === memberName &&
      hasModifier(member, ts.SyntaxKind.StaticKeyword) === staticReceiver,
  );
  if (methods.length > 0)
    return {
      targetId: targetId(
        classReference.filePath,
        `${classReference.className}.${memberName}`,
      ),
      inherited: visited.size > 0,
    };
  const heritage = classDeclaration.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
  );
  const baseType = heritage?.types[0];
  if (
    !baseType ||
    (baseType.typeArguments?.length ?? 0) > 0 ||
    !ts.isIdentifier(baseType.expression)
  )
    return { reason: "receiver-method-not-declared" };
  const base = classForTypeName(
    sourceFile,
    classReference.filePath,
    baseType.expression.text,
    projectId,
    source,
  );
  if (!("reference" in base)) return base;
  return resolveClassMethod(
    base.reference,
    memberName,
    staticReceiver,
    source,
    projectId,
    new Set(visited).add(key),
  );
}

function q3ReceiverType(
  state: System1QueryState,
  context: QueryContext,
  source: System1QuerySourceIndex,
  callSitePosition?: System1CallSitePosition,
): System1QueryResult {
  if (context.call.kind !== "member") return abstain("call-is-not-member-kind");
  const sourceFile = source.read(context.caller.filePath);
  if (!sourceFile || hasParseErrors(sourceFile))
    return abstain("caller-file-unparseable");
  const call = callSitePosition
    ? findCallSiteAtPosition(sourceFile, callSitePosition)
    : (() => {
        const calls = findCallSite(sourceFile, context.call.expression);
        return calls.length === 1 ? calls[0] : null;
      })();
  if (!call)
    return abstain(
      callSitePosition ? "callsite-not-at-position" : "callsite-not-unique",
    );
  if (
    callSitePosition &&
    compactSyntax(call.getText(sourceFile)) !==
      compactSyntax(context.call.expression)
  )
    return abstain("callsite-context-mismatch");
  if (
    (call.typeArguments?.length ?? 0) > 0 ||
    context.call.genericHints.length > 0 ||
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.name.text !== context.call.calleeName
  )
    return abstain("unsupported-member-call-shape");
  const receiver = receiverEvidence(
    call,
    sourceFile,
    context.caller.filePath,
    state.request.evidence.projectId,
    source,
  );
  if (!("classReference" in receiver)) return abstain(receiver.reason);
  const method = resolveClassMethod(
    receiver.classReference,
    context.call.calleeName,
    receiver.staticReceiver,
    source,
    state.request.evidence.projectId,
    new Set(),
  );
  if (!("targetId" in method)) return abstain(method.reason);
  const proof = method.inherited
    ? `${receiver.proof}-explicit-extends`
    : receiver.proof;
  return commitTarget(state, method.targetId, proof);
}

export function resolveSystem1DeterministicQueries(
  state: System1QueryState,
  source: System1QuerySourceIndex,
  callSitePosition?: System1CallSitePosition,
): System1QueryResults {
  const context = parseContext(state);
  const results = context
    ? {
        q1: q1ImportSource(state, context, source, callSitePosition),
        q2: q2ReexportTrace(state, context, source, callSitePosition),
        q3: q3ReceiverType(state, context, source, callSitePosition),
      }
    : {
        q1: abstain("invalid-request-context"),
        q2: abstain("invalid-request-context"),
        q3: abstain("invalid-request-context"),
      };
  return combineSystem1QueryResults(results);
}

export function combineSystem1QueryResults(
  results: Pick<System1QueryResults, "q1" | "q2" | "q3">,
): System1QueryResults {
  const committed = (["q1", "q2", "q3"] as const).flatMap((query) =>
    results[query].status === "commit"
      ? [{ query, result: results[query] }]
      : [],
  );
  const targets = new Set(committed.map(({ result }) => result.targetId));
  if (targets.size > 1) {
    return {
      ...results,
      cascade: {
        status: "abstain",
        reason: "query-conflict",
        conflictTargets: [...targets].sort(),
      },
    };
  }
  if (committed.length === 0)
    return {
      ...results,
      cascade: { status: "abstain", reason: "no-query-commit" },
    };
  const target = committed[0].result;
  if (target.status !== "commit")
    throw new Error("Internal query result narrowing failed.");
  return {
    ...results,
    cascade: {
      status: "commit",
      optionId: target.optionId,
      targetId: target.targetId,
      winningQueries: committed.map(({ query }) => query),
    },
  };
}
