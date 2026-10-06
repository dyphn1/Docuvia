/**
 * Query one pinned source snapshot with TypeScript's PartialSemantic mode.
 * Results are measurement evidence, never deterministic call-resolution proof.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { MAX_FILE_SIZE_BYTES } from "../../lib/contracts/src/index.js";
import {
  inspectSnapshotPath,
  readSnapshotSourceFile,
} from "./phase0-snapshot-safety.mts";

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
  /** 0-based worker source row and UTF-16 code-unit column. */
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
  readonly startLine: number | null;
  readonly startColumn: number | null;
  readonly endLine: number | null;
  readonly endColumn: number | null;
  /** Original TypeScript span, retained even when source text is unavailable. */
  readonly textSpan: { readonly start: number; readonly length: number };
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

function canonicalPathIdentity(
  filePath: string,
  useCaseSensitiveFileNames: boolean,
): string {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  return useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}

/** Return the sole path with the same TypeScript-host file identity. */
export function uniqueCanonicalPathMatch(
  paths: readonly string[],
  filePath: string,
  useCaseSensitiveFileNames: boolean,
): string | undefined {
  const identity = canonicalPathIdentity(filePath, useCaseSensitiveFileNames);
  let match: string | undefined;
  for (const candidate of paths) {
    if (
      canonicalPathIdentity(candidate, useCaseSensitiveFileNames) !== identity
    )
      continue;
    if (match !== undefined) return undefined;
    match = candidate;
  }
  return match;
}

function definitionRef(
  root: string,
  requestedRoot: string,
  verifiedSnapshotFiles: ReadonlyMap<string, string>,
  program: ts.Program,
  definition: ts.DefinitionInfo,
): PartialSemanticDefinitionRef | null {
  const absolute = path.resolve(definition.fileName);
  const relative =
    relativePath(root, absolute) ?? relativePath(requestedRoot, absolute);
  const external = relative === null || !verifiedSnapshotFiles.has(relative);
  const sourceFile = program.getSourceFile(absolute);
  if (!sourceFile && !external) return null;
  const start = sourceFile?.getLineAndCharacterOfPosition(
    definition.textSpan.start,
  );
  const end = sourceFile?.getLineAndCharacterOfPosition(
    definition.textSpan.start + definition.textSpan.length,
  );
  return {
    filePath: external ? normalizeExternalPath(absolute) : (relative as string),
    startLine: start?.line ?? null,
    startColumn: start?.character ?? null,
    endLine: end?.line ?? null,
    endColumn: end?.character ?? null,
    textSpan: {
      start: definition.textSpan.start,
      length: definition.textSpan.length,
    },
    symbolName: definition.name || null,
    containerName: definition.containerName || null,
    external,
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

function positionAt(
  sourceFile: ts.SourceFile,
  offsetUtf16: number,
): { readonly line: number; readonly column: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(offsetUtf16);
  return {
    line: location.line,
    column: location.character,
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
  const normalized = new Set<string>();
  for (const file of files) {
    const relative = file.replaceAll("\\", "/");
    if (
      relative.length > 0 &&
      !relative.startsWith("/") &&
      !relative
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === "..",
        )
    )
      normalized.add(relative);
  }
  return normalized;
}

interface SnapshotDirectoryEntries {
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

type MatchFiles = (
  path: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  useCaseSensitiveFileNames: boolean,
  currentDirectory: string,
  depth: number | undefined,
  getFileSystemEntries: (directory: string) => SnapshotDirectoryEntries,
  realpath: (path: string) => string,
) => string[];

/** Opens one isolated project in the actual TypeScript PartialSemantic mode. */
export function createPartialSemanticProject(
  options: PartialSemanticProjectOptions,
): PartialSemanticProject {
  const startupStart = performance.now();
  const requestedRoot = path.resolve(options.snapshotRoot);
  const root = ts.sys.realpath?.(requestedRoot) ?? requestedRoot;

  const snapshotFiles = normalizedSnapshotFiles(options.snapshotFiles);
  const snapshotFileIdentities = new Set(
    [...snapshotFiles].map((filePath) =>
      canonicalPathIdentity(filePath, ts.sys.useCaseSensitiveFileNames),
    ),
  );
  const verifiedSnapshotFiles = new Map<string, string>();
  for (const file of snapshotFiles) {
    const inspection = inspectSnapshotPath(root, file);
    if (
      inspection.status === "safe" &&
      inspection.sizeBytes <= MAX_FILE_SIZE_BYTES
    )
      verifiedSnapshotFiles.set(file, inspection.absolutePath);
  }

  const relativeSnapshotPath = (fileName: string): string | null =>
    relativePath(requestedRoot, fileName) ?? relativePath(root, fileName);
  const readSnapshotCache = new Map<string, Buffer>();
  const readVerifiedSnapshotFile = (relative: string): Buffer | undefined => {
    const cached = readSnapshotCache.get(relative);
    if (cached) return cached;
    if (!verifiedSnapshotFiles.has(relative)) return undefined;
    const result = readSnapshotSourceFile(root, relative, MAX_FILE_SIZE_BYTES);
    if (result.status !== "readable") return undefined;
    readSnapshotCache.set(relative, result.bytes);
    return result.bytes;
  };
  const readVerifiedSnapshotText = (fileName: string): string | undefined => {
    const relative = relativeSnapshotPath(fileName);
    if (relative === null) return undefined;
    return readVerifiedSnapshotFile(relative)?.toString(UTF8);
  };
  const snapshotDirectoryEntries = (
    directory: string,
  ): SnapshotDirectoryEntries => {
    const relativeDirectory = relativeSnapshotPath(directory);
    if (relativeDirectory === null) return { files: [], directories: [] };
    const prefix = relativeDirectory === "" ? "" : `${relativeDirectory}/`;
    const files = new Set<string>();
    const directories = new Set<string>();
    for (const relativeFile of verifiedSnapshotFiles.keys()) {
      if (!relativeFile.startsWith(prefix)) continue;
      const remainder = relativeFile.slice(prefix.length);
      if (remainder.length === 0) continue;
      const separator = remainder.indexOf("/");
      if (separator < 0) files.add(remainder);
      else directories.add(remainder.slice(0, separator));
    }
    return {
      files: [...files].sort(),
      directories: [...directories].sort(),
    };
  };
  const snapshotDirectoryExists = (directory: string): boolean => {
    const relativeDirectory = relativeSnapshotPath(directory);
    if (relativeDirectory === null) return false;
    if (relativeDirectory === "") return true;
    const prefix = `${relativeDirectory}/`;
    return [...verifiedSnapshotFiles.keys()].some((file) =>
      file.startsWith(prefix),
    );
  };
  const snapshotReadDirectory = (
    directory: string,
    extensions: readonly string[] | undefined,
    excludes: readonly string[] | undefined,
    includes: readonly string[] | undefined,
    depth: number | undefined,
  ): string[] => {
    const relativeDirectory = relativeSnapshotPath(directory);
    if (relativeDirectory === null) return [];
    const matchFiles = (ts as unknown as { readonly matchFiles?: MatchFiles })
      .matchFiles;
    if (!matchFiles)
      throw new Error("TypeScript safe snapshot matcher is unavailable.");
    const safeDirectory = path.resolve(root, relativeDirectory);
    return matchFiles(
      safeDirectory,
      extensions,
      excludes,
      includes,
      ts.sys.useCaseSensitiveFileNames,
      root,
      depth,
      snapshotDirectoryEntries,
      (fileName) => fileName,
    );
  };

  const projectPath = path.resolve(root, options.projectId);
  const projectRelative = relativePath(root, projectPath);
  if (projectRelative === null || projectRelative === "")
    throw new Error(
      `Project config escapes the source snapshot: ${options.projectId}`,
    );

  if (!verifiedSnapshotFiles.has(projectRelative))
    throw new Error(
      `Project config is not a verified snapshot file: ${options.projectId}`,
    );

  const projectConfigBytes = readVerifiedSnapshotFile(projectRelative);
  if (!projectConfigBytes)
    throw new Error(
      `Project config is not readable from the verified snapshot: ${options.projectId}`,
    );

  const snapshotFileExists = (fileName: string): boolean => {
    const relative = relativeSnapshotPath(fileName);
    return relative !== null && verifiedSnapshotFiles.has(relative);
  };

  const parseHost: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: (fileName) =>
      snapshotFileExists(fileName) ||
      (isWithin(TYPESCRIPT_LIBRARY_ROOT, fileName) &&
        ts.sys.fileExists(fileName)),
    readFile: (fileName) => {
      const snapshotText = readVerifiedSnapshotText(fileName);
      if (snapshotText !== undefined) return snapshotText;
      return isWithin(TYPESCRIPT_LIBRARY_ROOT, fileName)
        ? ts.sys.readFile(fileName)
        : undefined;
    },
    readDirectory: (directory, extensions, excludes, includes, depth) => {
      if (isWithin(TYPESCRIPT_LIBRARY_ROOT, directory))
        return ts.sys.readDirectory(
          directory,
          extensions,
          excludes,
          includes,
          depth,
        );
      return snapshotReadDirectory(
        directory,
        extensions,
        excludes,
        includes,
        depth,
      );
    },
    directoryExists: (directory) =>
      isWithin(TYPESCRIPT_LIBRARY_ROOT, directory)
        ? ts.sys.directoryExists?.(directory) === true
        : snapshotDirectoryExists(directory),
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

  const rootFiles = parsed.fileNames
    .filter((fileName) => {
      const relative = relativeSnapshotPath(fileName);
      return relative !== null && verifiedSnapshotFiles.has(relative);
    })
    .sort();
  const rootFileRelativePaths: string[] = [];
  const rootFileNameByRelativePath = new Map<string, string>();
  for (const fileName of rootFiles) {
    const relative = relativeSnapshotPath(fileName);
    if (relative === null) continue;
    rootFileRelativePaths.push(relative);
    rootFileNameByRelativePath.set(relative, fileName);
  }
  const compilerOptions: ts.CompilerOptions = {
    ...parsed.options,
    noResolve: true,
    types: [],
  };
  const readFile = (fileName: string): string | undefined => {
    const snapshotText = readVerifiedSnapshotText(fileName);
    if (snapshotText !== undefined) return snapshotText;
    return isWithin(TYPESCRIPT_LIBRARY_ROOT, fileName)
      ? ts.sys.readFile(fileName)
      : undefined;
  };
  const fileExists = (fileName: string): boolean => {
    const relative = relativeSnapshotPath(fileName);
    return (
      (relative !== null && verifiedSnapshotFiles.has(relative)) ||
      (isWithin(TYPESCRIPT_LIBRARY_ROOT, fileName) &&
        ts.sys.fileExists(fileName))
    );
  };
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
    readDirectory: (directory, extensions, excludes, includes, depth) => {
      if (isWithin(TYPESCRIPT_LIBRARY_ROOT, directory))
        return ts.sys.readDirectory(
          directory,
          extensions,
          excludes,
          includes,
          depth,
        );
      return snapshotReadDirectory(
        directory,
        extensions,
        excludes,
        includes,
        depth,
      );
    },
    directoryExists: (directory) =>
      isWithin(TYPESCRIPT_LIBRARY_ROOT, directory)
        ? ts.sys.directoryExists?.(directory) === true
        : snapshotDirectoryExists(directory),
    getDirectories: (directory) => {
      if (isWithin(TYPESCRIPT_LIBRARY_ROOT, directory))
        return ts.sys.getDirectories?.(directory) ?? [];
      return [...snapshotDirectoryEntries(directory).directories];
    },
    realpath: (fileName) => {
      if (isWithin(TYPESCRIPT_LIBRARY_ROOT, fileName))
        return ts.sys.realpath?.(fileName) ?? fileName;
      const relative = relativeSnapshotPath(fileName);
      if (
        relative !== null &&
        (verifiedSnapshotFiles.has(relative) ||
          snapshotDirectoryExists(fileName))
      )
        return path.resolve(root, relative);
      return fileName;
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
      const relative = relativeSnapshotPath(sourceFile.fileName);
      return relative !== null && verifiedSnapshotFiles.has(relative)
        ? relative
        : normalizeExternalPath(sourceFile.fileName);
    })
    .sort();
  const configHash = sha256(
    [
      sha256(projectConfigBytes),
      JSON.stringify(stableConfigValue(compilerOptions, root)),
      JSON.stringify(
        rootFiles.map((fileName) => relativeSnapshotPath(fileName)),
      ),
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
      (fileName) => relativeSnapshotPath(fileName) as string,
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
      const rootFileRelativePath = uniqueCanonicalPathMatch(
        rootFileRelativePaths,
        relative,
        ts.sys.useCaseSensitiveFileNames,
      );
      const rootFileName =
        rootFileRelativePath === undefined
          ? undefined
          : rootFileNameByRelativePath.get(rootFileRelativePath);
      if (
        !snapshotFileIdentities.has(
          canonicalPathIdentity(relative, ts.sys.useCaseSensitiveFileNames),
        ) ||
        !rootFileName
      )
        return emptyResult("unsupported", "source-file-not-in-partial-project");
      const sourceFile = program.getSourceFile(rootFileName);
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
      const position = positionAt(sourceFile, site.offsetUtf16);
      if (site.line !== position.line || site.column !== position.column)
        return emptyResult("invalid-position", "callee-position-mismatch");
      const actualKind = callKindAtIdentifier(identifier);
      if (actualKind === "unsupported")
        return emptyResult("unsupported", "unsupported-callee-shape");
      if (actualKind === null)
        return emptyResult("invalid-position", "callee-not-in-call-expression");
      if (actualKind !== site.calleeKind)
        return emptyResult("invalid-position", "callee-kind-mismatch");

      const queryStart = performance.now();
      try {
        const rawDefinitions =
          languageService.getDefinitionAtPosition(absolute, site.offsetUtf16) ??
          [];
        const definitions: PartialSemanticDefinitionRef[] = [];
        for (const definition of rawDefinitions) {
          const reference = definitionRef(
            root,
            requestedRoot,
            verifiedSnapshotFiles,
            program,
            definition,
          );
          if (!reference)
            return emptyResult(
              "error",
              "definition-source-not-in-partial-program",
              performance.now() - queryStart,
            );
          definitions.push(reference);
        }
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
