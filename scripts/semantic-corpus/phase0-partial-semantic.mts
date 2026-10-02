/**
 * Query one pinned source snapshot with TypeScript's PartialSemantic mode.
 * Results are measurement evidence, never deterministic call-resolution proof.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";

const UTF8 = "utf8";
const HASH_SEPARATOR = "\0";
const TYPESCRIPT_LIBRARY_ROOT = path.dirname(ts.getDefaultLibFilePath({}));

export type PartialSemanticCallKind = "bare" | "member" | "constructor";

export type PartialSemanticStatus =
  | "resolved"
  | "multiple-definitions"
  | "mixed"
  | "external-only"
  | "no-result"
  | "unsupported"
  | "invalid-position"
  | "error";

export interface PartialSemanticCallSite {
  readonly filePath: string | null;
  /** 0-based Tree-sitter row and UTF-8 byte column. */
  readonly line: number | null;
  readonly column: number | null;
  /** TypeScript UTF-16 code-unit offset at the callee/member property. */
  readonly offsetUtf16: number | null;
  readonly calleeKind: string | null;
  readonly calleeName: string | null;
  readonly positionStatus?: string | null;
  readonly exclusionReason?: string | null;
}

export interface PartialSemanticDefinitionRef {
  readonly filePath: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly symbolName: string | null;
  readonly containerName: string | null;
  readonly external: boolean;
}

export interface PartialSemanticQueryResult {
  readonly status: PartialSemanticStatus;
  readonly reason: string | null;
  /** Every raw definition returned by TypeScript is retained in service order. */
  readonly definitions: readonly PartialSemanticDefinitionRef[];
  /** Time spent in the TypeScript definition request and normalization. */
  readonly latencyMs: number | null;
}

export interface PartialSemanticProjectMetadata {
  readonly typescriptVersion: string;
  readonly languageServiceMode: "PartialSemantic";
  readonly configHash: string;
  readonly compilerOptions: {
    readonly noResolve: true;
    readonly types: readonly [];
  };
  readonly rootFiles: readonly string[];
  readonly programFiles: readonly string[];
  readonly startupMs: number;
  readonly readyMs: number;
}

export interface PartialSemanticProject {
  readonly metadata: PartialSemanticProjectMetadata;
  query(site: PartialSemanticCallSite): PartialSemanticQueryResult;
  close(): void;
}

export interface PartialSemanticProjectOptions {
  readonly snapshotRoot: string;
  readonly projectId: string;
  /** Paths from the verified snapshot manifest, normalized with `/`. */
  readonly snapshotFiles: ReadonlySet<string>;
  /** Test seam for exercising typed service failures; production uses TypeScript directly. */
  readonly createLanguageService?: (
    host: ts.LanguageServiceHost,
    mode: ts.LanguageServiceMode,
  ) => ts.LanguageService;
}

type StatusResult = Pick<PartialSemanticQueryResult, "status" | "reason">;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function relativePath(root: string, filePath: string): string | null {
  const absolute = path.resolve(filePath);
  const relative = path.relative(root, absolute);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return relative === "" ? "" : null;
  return relative.split(path.sep).join("/");
}

function isWithin(directory: string, filePath: string): boolean {
  const relative = path.relative(directory, path.resolve(filePath));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function isSnapshotPath(root: string, filePath: string): boolean {
  if (relativePath(root, filePath) === null) return false;
  const realpath = ts.sys.realpath?.(filePath);
  return realpath === undefined || relativePath(root, realpath) !== null;
}

function stableConfigValue(value: unknown, root: string): unknown {
  if (Array.isArray(value))
    return value.map((entry) => stableConfigValue(entry, root));
  if (typeof value === "string" && path.isAbsolute(value))
    return (
      relativePath(root, value) ?? `<outside-snapshot:${path.basename(value)}>`
    );
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en-US"))
        .map(([key, entry]) => [key, stableConfigValue(entry, root)]),
    );
  return value;
}

function configDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    )
    .join("; ");
}

function normalizeExternalPath(filePath: string): string {
  const absolute = path.resolve(filePath);
  if (isWithin(TYPESCRIPT_LIBRARY_ROOT, absolute))
    return `typescript/${path.basename(absolute)}`;
  const nodeModules = absolute.split(path.sep).lastIndexOf("node_modules");
  if (nodeModules >= 0)
    return absolute.split(path.sep).slice(nodeModules).join("/");
  return `outside-snapshot/${path.basename(absolute)}`;
}

function definitionRef(
  root: string,
  snapshotFiles: ReadonlySet<string>,
  program: ts.Program,
  definition: ts.DefinitionInfo,
): PartialSemanticDefinitionRef {
  const absolute = path.resolve(definition.fileName);
  const relative = relativePath(root, absolute);
  const isInSnapshot = relative !== null && snapshotFiles.has(relative);
  const sourceFile = program.getSourceFile(absolute);
  const sourceText = sourceFile?.text ?? ts.sys.readFile(absolute) ?? "";
  const locationFile =
    sourceFile ??
    ts.createSourceFile(absolute, sourceText, ts.ScriptTarget.Latest, true);
  const start = locationFile.getLineAndCharacterOfPosition(
    definition.textSpan.start,
  );
  const end = locationFile.getLineAndCharacterOfPosition(
    definition.textSpan.start + definition.textSpan.length,
  );
  return {
    filePath: isInSnapshot ? relative : normalizeExternalPath(absolute),
    startLine: start.line,
    startColumn: start.character,
    endLine: end.line,
    endColumn: end.character,
    symbolName: definition.name || null,
    containerName: definition.containerName || null,
    external: !isInSnapshot,
  };
}

/** Classifies raw definition refs without filtering or deduplicating them. */
export function classifyPartialSemanticDefinitions(
  definitions: readonly Pick<PartialSemanticDefinitionRef, "external">[],
): StatusResult {
  if (definitions.length === 0)
    return { status: "no-result", reason: "definition-not-found" };
  const localCount = definitions.filter(({ external }) => !external).length;
  const externalCount = definitions.length - localCount;
  if (localCount > 0 && externalCount > 0)
    return { status: "mixed", reason: "local-and-external-definitions" };
  if (localCount === 0)
    return { status: "external-only", reason: "definitions-outside-snapshot" };
  if (localCount > 1)
    return {
      status: "multiple-definitions",
      reason: "multiple-local-definitions",
    };
  return { status: "resolved", reason: null };
}

function emptyResult(
  status: PartialSemanticStatus,
  reason: string,
  latencyMs: number | null = null,
): PartialSemanticQueryResult {
  return { status, reason, definitions: [], latencyMs };
}

function containsNode(container: ts.Node, target: ts.Node): boolean {
  for (let node: ts.Node | undefined = target; node; node = node.parent)
    if (node === container) return true;
  return false;
}

function unparenthesize(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function callKindAtIdentifier(
  identifier: ts.Identifier | ts.PrivateIdentifier,
): PartialSemanticCallKind | "unsupported" | null {
  for (
    let node: ts.Node | undefined = identifier.parent;
    node;
    node = node.parent
  ) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (!containsNode(node.expression, identifier)) return null;
      const expression = unparenthesize(node.expression);
      if (ts.isIdentifier(expression) || ts.isPrivateIdentifier(expression))
        return ts.isNewExpression(node) ? "constructor" : "bare";
      if (
        ts.isPropertyAccessExpression(expression) &&
        expression.name === identifier
      )
        return ts.isNewExpression(node) ? "constructor" : "member";
      return "unsupported";
    }
    if (
      ts.isStatement(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)
    )
      return null;
  }
  return null;
}

function bytePositionAt(
  sourceFile: ts.SourceFile,
  offsetUtf16: number,
): { readonly line: number; readonly column: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(offsetUtf16);
  const lineStart = sourceFile.getLineStarts()[location.line];
  return {
    line: location.line,
    column: Buffer.byteLength(
      sourceFile.text.slice(lineStart, offsetUtf16),
      UTF8,
    ),
  };
}

function identifierAt(
  sourceFile: ts.SourceFile,
  offset: number,
): ts.Identifier | ts.PrivateIdentifier | undefined {
  let match: ts.Identifier | ts.PrivateIdentifier | undefined;
  const visit = (node: ts.Node): void => {
    if (match || offset < node.getStart(sourceFile) || offset >= node.getEnd())
      return;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return match;
}

function normalizedSnapshotFiles(files: ReadonlySet<string>): Set<string> {
  return new Set([...files].map((file) => file.replaceAll("\\", "/")));
}

/** Opens one isolated project in the actual TypeScript PartialSemantic mode. */
export function createPartialSemanticProject(
  options: PartialSemanticProjectOptions,
): PartialSemanticProject {
  const startupStart = performance.now();
  const requestedRoot = path.resolve(options.snapshotRoot);
  const root = ts.sys.realpath?.(requestedRoot) ?? requestedRoot;
  const projectPath = path.resolve(root, options.projectId);
  const projectRelative = relativePath(root, projectPath);
  if (projectRelative === null || projectRelative === "")
    throw new Error(
      `Project config escapes the source snapshot: ${options.projectId}`,
    );

  const parseHost: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: (fileName) =>
      isSnapshotPath(root, fileName) && ts.sys.fileExists(fileName),
    readFile: (fileName) =>
      !isSnapshotPath(root, fileName) ? undefined : ts.sys.readFile(fileName),
    readDirectory: (directory, extensions, excludes, includes, depth) =>
      !isSnapshotPath(root, directory)
        ? []
        : ts.sys
            .readDirectory(directory, extensions, excludes, includes, depth)
            .filter((fileName) => isSnapshotPath(root, fileName)),
  };
  const config = ts.readConfigFile(projectPath, parseHost.readFile);
  if (config.error) throw new Error(configDiagnostics([config.error]));
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    parseHost,
    path.dirname(projectPath),
    undefined,
    projectPath,
  );
  if (parsed.errors.length > 0)
    throw new Error(configDiagnostics(parsed.errors));

  const snapshotFiles = normalizedSnapshotFiles(options.snapshotFiles);
  const rootFiles = parsed.fileNames
    .filter((fileName) => {
      const relative = relativePath(root, fileName);
      return relative !== null && snapshotFiles.has(relative);
    })
    .sort();
  const compilerOptions: ts.CompilerOptions = {
    ...parsed.options,
    noResolve: true,
    types: [],
  };
  const isAllowedFile = (fileName: string): boolean =>
    isSnapshotPath(root, fileName) ||
    isWithin(TYPESCRIPT_LIBRARY_ROOT, fileName);
  const readFile = (fileName: string): string | undefined =>
    isAllowedFile(fileName) ? ts.sys.readFile(fileName) : undefined;
  const fileExists = (fileName: string): boolean =>
    isAllowedFile(fileName) && ts.sys.fileExists(fileName);
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => rootFiles,
    getScriptVersion: () => "0",
    getScriptSnapshot: (fileName) => {
      const source = readFile(fileName);
      return source === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(source);
    },
    getCurrentDirectory: () => path.dirname(projectPath),
    getDefaultLibFileName: (compilerOptions) =>
      ts.getDefaultLibFilePath(compilerOptions),
    fileExists,
    readFile,
    readDirectory: (directory, extensions, excludes, includes, depth) =>
      !isSnapshotPath(root, directory)
        ? []
        : ts.sys
            .readDirectory(directory, extensions, excludes, includes, depth)
            .filter((fileName) => isSnapshotPath(root, fileName)),
    directoryExists: (directory) =>
      isSnapshotPath(root, directory) &&
      ts.sys.directoryExists?.(directory) === true,
    getDirectories: (directory) =>
      !isSnapshotPath(root, directory)
        ? []
        : (ts.sys.getDirectories?.(directory) ?? []).filter((entry) =>
            isSnapshotPath(root, path.join(directory, entry)),
          ),
    realpath: (fileName) => {
      const resolved = ts.sys.realpath?.(fileName) ?? fileName;
      if (isWithin(TYPESCRIPT_LIBRARY_ROOT, fileName)) return resolved;
      return isSnapshotPath(root, resolved) ? resolved : fileName;
    },
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };
  const mode = ts.LanguageServiceMode.PartialSemantic;
  const languageService = options.createLanguageService
    ? options.createLanguageService(host, mode)
    : ts.createLanguageService(host, undefined, mode);
  const startupMs = performance.now() - startupStart;
  const readyStart = performance.now();
  let program: ts.Program | undefined;
  try {
    program = languageService.getProgram();
  } catch (error) {
    languageService.dispose();
    throw error;
  }
  if (!program) {
    languageService.dispose();
    throw new Error("PartialSemantic language service produced no program.");
  }
  const readyMs = performance.now() - readyStart;
  const programFiles = program
    .getSourceFiles()
    .map((sourceFile) => {
      const relative = relativePath(root, sourceFile.fileName);
      return relative ?? normalizeExternalPath(sourceFile.fileName);
    })
    .sort();
  const configHash = sha256(
    [
      sha256(readFileSync(projectPath)),
      JSON.stringify(stableConfigValue(compilerOptions, root)),
      JSON.stringify(rootFiles.map((fileName) => relativePath(root, fileName))),
      ts.version,
    ].join(HASH_SEPARATOR),
  );
  let closed = false;

  const metadata: PartialSemanticProjectMetadata = {
    typescriptVersion: ts.version,
    languageServiceMode: "PartialSemantic",
    configHash,
    compilerOptions: { noResolve: true, types: [] },
    rootFiles: rootFiles.map(
      (fileName) => relativePath(root, fileName) as string,
    ),
    programFiles,
    startupMs,
    readyMs,
  };

  return {
    metadata,
    query(site) {
      if (closed) return emptyResult("error", "partial-project-closed");
      if (
        !site.filePath ||
        !site.calleeName ||
        site.offsetUtf16 === null ||
        !Number.isInteger(site.offsetUtf16) ||
        site.offsetUtf16 < 0 ||
        site.line === null ||
        !Number.isInteger(site.line) ||
        site.line < 0 ||
        site.column === null ||
        !Number.isInteger(site.column) ||
        site.column < 0 ||
        (site.positionStatus !== undefined &&
          site.positionStatus !== null &&
          site.positionStatus !== "unique")
      )
        return emptyResult(
          "invalid-position",
          site.exclusionReason ??
            site.positionStatus ??
            "missing-callee-position",
        );
      if (!site.calleeKind)
        return emptyResult("unsupported", "missing-callee-kind");
      if (!["bare", "member", "constructor"].includes(site.calleeKind))
        return emptyResult("unsupported", "unsupported-callee-kind");
      if (
        ![
          ".ts",
          ".tsx",
          ".mts",
          ".cts",
          ".js",
          ".jsx",
          ".mjs",
          ".cjs",
        ].includes(path.extname(site.filePath).toLowerCase())
      )
        return emptyResult("unsupported", "unsupported-source-extension");

      const absolute = path.resolve(root, site.filePath);
      const relative = relativePath(root, absolute);
      if (relative === null)
        return emptyResult("unsupported", "source-path-escapes-snapshot");
      if (!snapshotFiles.has(relative) || !rootFiles.includes(absolute))
        return emptyResult("unsupported", "source-file-not-in-partial-project");
      const sourceFile = program.getSourceFile(absolute);
      if (!sourceFile)
        return emptyResult("unsupported", "source-file-not-in-partial-program");
      if (site.offsetUtf16 >= sourceFile.text.length)
        return emptyResult("invalid-position", "callee-offset-out-of-range");

      const identifier = identifierAt(sourceFile, site.offsetUtf16);
      if (!identifier || identifier.text !== site.calleeName)
        return emptyResult("invalid-position", "callee-token-mismatch");
      if (identifier.getStart(sourceFile) !== site.offsetUtf16)
        return emptyResult(
          "invalid-position",
          "callee-offset-not-at-token-start",
        );
      const position = bytePositionAt(sourceFile, site.offsetUtf16);
      if (site.line !== position.line || site.column !== position.column)
        return emptyResult("invalid-position", "callee-byte-position-mismatch");
      const actualKind = callKindAtIdentifier(identifier);
      if (actualKind === "unsupported")
        return emptyResult("unsupported", "unsupported-callee-shape");
      if (actualKind === null)
        return emptyResult("invalid-position", "callee-not-in-call-expression");
      if (actualKind !== site.calleeKind)
        return emptyResult("invalid-position", "callee-kind-mismatch");

      const queryStart = performance.now();
      try {
        const definitions =
          languageService
            .getDefinitionAtPosition(absolute, site.offsetUtf16)
            ?.map((definition) =>
              definitionRef(root, snapshotFiles, program, definition),
            ) ?? [];
        return {
          ...classifyPartialSemanticDefinitions(definitions),
          definitions,
          latencyMs: performance.now() - queryStart,
        };
      } catch (error) {
        return emptyResult(
          "error",
          error instanceof Error ? error.message : String(error),
          performance.now() - queryStart,
        );
      }
    },
    close() {
      if (closed) return;
      closed = true;
      languageService.dispose();
    },
  };
}
