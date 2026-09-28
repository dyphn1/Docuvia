import * as path from "path";
import {
  DynamicDependencyKinds,
  DynamicDependencyStatuses,
  DynamicEvidenceAvailabilityStates,
  DynamicEvidenceUnavailableReasons,
  type DynamicDependencyEvidence,
  type DynamicEvidenceAvailability,
  type DynamicEvidenceUnavailableReason,
  type IGraphStore,
  type ParsedAstFileResult,
} from "@workspace/contracts";
import {
  readFileWithinRootResult,
  ReadFileWithinRootStatuses,
} from "../utils/safe-fs.js";

const META_KEY_PREFIX = "impact.dynamic-dependencies.v1";
const MAX_BOUNDED_CANDIDATES = 64;
const PROJECT_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/**
 * Issue #508 D3: the runtime spelling a TS/JS source is imported by under NodeNext/ESM
 * resolution -- `./x.js` names `x.ts`/`x.tsx`/`x.js`/`x.jsx`, `./x.mjs` names `x.mts`/`x.mjs`,
 * and `./x.cjs` names `x.cts`/`x.cjs`.
 */
const RUNTIME_EXTENSION_BY_SOURCE_EXTENSION: Readonly<Record<string, string>> =
  {
    ".ts": ".js",
    ".tsx": ".js",
    ".js": ".js",
    ".jsx": ".js",
    ".mts": ".mjs",
    ".mjs": ".mjs",
    ".cts": ".cjs",
    ".cjs": ".cjs",
  };

interface ScannedDynamicImport {
  expression: string;
  startLine: number;
  startColumn: number;
  literalPrefix?: string;
  literalSuffix?: string;
  interpolated: boolean;
}

interface DynamicImportScanMatch {
  item: ScannedDynamicImport;
  nextIndex: number;
}

function metaKey(projectId: number): string {
  return `${META_KEY_PREFIX}:${projectId}`;
}

function isIdentifierChar(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/.test(value);
}

function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return source.length;
}

function skipLineComment(source: string, start: number): number {
  const newline = source.indexOf("\n", start + 2);
  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

/** Returns the first index after a comment/string token, or undefined when `start` is code. */
function skipIgnoredToken(source: string, start: number): number | undefined {
  const ch = source[start];
  const next = source[start + 1];
  if (ch === "/" && next === "/") return skipLineComment(source, start);
  if (ch === "/" && next === "*") return skipBlockComment(source, start);
  if (ch === "'" || ch === '"' || ch === "`") {
    return skipQuoted(source, start, ch);
  }
  return undefined;
}

function findClosingParen(
  source: string,
  openIndex: number,
): number | undefined {
  let depth = 1;
  let i = openIndex + 1;
  while (i < source.length) {
    const skipped = skipIgnoredToken(source, i);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }
    if (source[i] === "(") depth++;
    if (source[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return undefined;
}

function sourcePosition(
  source: string,
  index: number,
): { line: number; column: number } {
  const before = source.slice(0, index);
  const line = before.split("\n").length - 1;
  const lastNewline = before.lastIndexOf("\n");
  return { line, column: index - lastNewline - 1 };
}

function literalParts(expression: string): {
  literalPrefix?: string;
  literalSuffix?: string;
  interpolated: boolean;
} {
  if (expression.length < 2) return { interpolated: false };
  const quote = expression[0];
  if ((quote === "'" || quote === '"') && expression.at(-1) === quote) {
    return {
      literalPrefix: expression.slice(1, -1),
      interpolated: false,
    };
  }
  if (quote !== "`" || expression.at(-1) !== "`") {
    return { interpolated: false };
  }

  const body = expression.slice(1, -1);
  const firstInterpolation = body.indexOf("${");
  if (firstInterpolation < 0) {
    return { literalPrefix: body, interpolated: false };
  }
  const lastInterpolationEnd = body.lastIndexOf("}");
  return {
    literalPrefix: body.slice(0, firstInterpolation),
    literalSuffix:
      lastInterpolationEnd >= firstInterpolation
        ? body.slice(lastInterpolationEnd + 1)
        : undefined,
    interpolated: true,
  };
}

function isImportKeywordAt(source: string, index: number): boolean {
  if (!source.startsWith("import", index)) return false;
  if (isIdentifierChar(source[index - 1])) return false;
  return !isIdentifierChar(source[index + 6]);
}

function scanDynamicImportAt(
  source: string,
  index: number,
): DynamicImportScanMatch | undefined {
  if (!isImportKeywordAt(source, index)) return undefined;
  let open = index + 6;
  while (/\s/.test(source[open] ?? "")) open++;
  if (source[open] !== "(") return undefined;

  const close = findClosingParen(source, open);
  if (close === undefined) return undefined;
  const raw = source.slice(open + 1, close);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const expression = raw.trim();
  if (expression.length === 0) return undefined;

  const expressionStart = open + 1 + leadingWhitespace;
  const position = sourcePosition(source, expressionStart);
  return {
    item: {
      expression,
      startLine: position.line,
      startColumn: position.column,
      ...literalParts(expression),
    },
    nextIndex: close + 1,
  };
}

/**
 * Small lexical scanner for TS/JS `import(expr)` boundaries. It intentionally does not try to
 * evaluate arbitrary JavaScript: comments and ordinary string/template literals are skipped while
 * looking for the `import` keyword, then the raw argument expression is preserved verbatim. This
 * keeps #393 evidence deterministic without promoting guessed runtime values into graph edges.
 */
export function scanDynamicImports(source: string): ScannedDynamicImport[] {
  const result: ScannedDynamicImport[] = [];
  let i = 0;
  while (i < source.length) {
    const skipped = skipIgnoredToken(source, i);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }
    const match = scanDynamicImportAt(source, i);
    if (match) {
      result.push(match.item);
      i = match.nextIndex;
      continue;
    }
    i++;
  }
  return result;
}

function normalizeWorkspacePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function stripProjectExtension(filePath: string): string {
  const ext = path.posix.extname(filePath);
  return PROJECT_SOURCE_EXTENSIONS.has(ext)
    ? filePath.slice(0, -ext.length)
    : filePath;
}

/** Extension-less stem plus, for TS/JS sources, the NodeNext runtime spelling (#508 D3). */
function importSpellings(targetFile: string): string[] {
  const stem = stripProjectExtension(targetFile);
  const runtimeExtension =
    RUNTIME_EXTENSION_BY_SOURCE_EXTENSION[path.posix.extname(targetFile)];
  return runtimeExtension ? [stem, `${stem}${runtimeExtension}`] : [stem];
}

function resolveLocalPatternPrefix(
  sourceFile: string,
  literalPrefix: string | undefined,
): string | undefined {
  if (!literalPrefix?.startsWith(".")) return undefined;
  const sourceDir = path.posix.dirname(normalizeWorkspacePath(sourceFile));
  const normalized = path.posix.normalize(
    path.posix.join(sourceDir, normalizeWorkspacePath(literalPrefix)),
  );
  return literalPrefix.endsWith("/") && !normalized.endsWith("/")
    ? `${normalized}/`
    : normalized;
}

function patternCouldMatchTarget(
  sourceFile: string,
  scanned: Pick<
    ScannedDynamicImport,
    "literalPrefix" | "literalSuffix" | "interpolated"
  >,
  targetFile: string,
): boolean {
  const prefix = resolveLocalPatternPrefix(sourceFile, scanned.literalPrefix);
  if (!prefix) return !scanned.literalPrefix;
  const target = normalizeWorkspacePath(targetFile);
  const spellings = importSpellings(target);
  if (!scanned.interpolated) {
    return target === prefix || spellings.includes(prefix);
  }
  const suffix = scanned.literalSuffix ?? "";
  return spellings.some(
    (spelling) => spelling.startsWith(prefix) && spelling.endsWith(suffix),
  );
}

function resolveCandidates(
  sourceFile: string,
  scanned: ScannedDynamicImport,
  knownFiles: string[],
): Pick<DynamicDependencyEvidence, "status" | "candidatePaths" | "reason"> {
  const prefix = resolveLocalPatternPrefix(sourceFile, scanned.literalPrefix);
  if (!prefix) {
    return {
      status: DynamicDependencyStatuses.UNRESOLVED,
      candidatePaths: [],
      reason: scanned.literalPrefix
        ? "non-local-dynamic-specifier"
        : "unbounded-runtime-expression",
    };
  }

  const matches = knownFiles
    .filter((candidate) =>
      patternCouldMatchTarget(sourceFile, scanned, candidate),
    )
    .sort((a, b) => a.localeCompare(b));
  if (matches.length === 0) {
    return {
      status: DynamicDependencyStatuses.UNRESOLVED,
      candidatePaths: [],
      reason: "no-known-local-candidate",
    };
  }
  if (matches.length > MAX_BOUNDED_CANDIDATES) {
    return {
      status: DynamicDependencyStatuses.UNRESOLVED,
      candidatePaths: [],
      reason: `candidate-set-exceeds-${MAX_BOUNDED_CANDIDATES}`,
    };
  }
  return {
    status: DynamicDependencyStatuses.BOUNDED,
    candidatePaths: matches,
    reason: scanned.interpolated
      ? "bounded-local-pattern"
      : "literal-dynamic-import",
  };
}

/** Rebuilds the scan-time pattern of a persisted record (expression + literal parts are stored,
 *  `interpolated` is derived), so it can be re-matched without re-reading its source file. */
export function scannedFromEvidence(
  item: DynamicDependencyEvidence,
): ScannedDynamicImport {
  return {
    expression: item.expression,
    startLine: item.startLine,
    startColumn: item.startColumn,
    literalPrefix: item.literalPrefix,
    literalSuffix: item.literalSuffix,
    interpolated:
      item.expression.startsWith("`") &&
      item.expression.endsWith("`") &&
      item.expression.includes("${"),
  };
}

function sortEvidence(
  items: DynamicDependencyEvidence[],
): DynamicDependencyEvidence[] {
  return items.sort(
    (a, b) =>
      a.sourceFile.localeCompare(b.sourceFile) ||
      a.startLine - b.startLine ||
      a.startColumn - b.startColumn ||
      a.expression.localeCompare(b.expression),
  );
}

/** Issue #508 Phase 2 (D1/D5): the persisted evidence set, or why it cannot be trusted. */
export type DynamicDependencyEvidenceState =
  | {
      state: typeof DynamicEvidenceAvailabilityStates.AVAILABLE;
      items: DynamicDependencyEvidence[];
    }
  | {
      state: typeof DynamicEvidenceAvailabilityStates.UNAVAILABLE;
      reason: DynamicEvidenceUnavailableReason;
    };

const DYNAMIC_DEPENDENCY_STATUS_VALUES: ReadonlySet<unknown> = new Set(
  Object.values(DynamicDependencyStatuses),
);

const EVIDENCE_STRING_FIELDS = [
  "sourceFile",
  "kind",
  "expression",
  "reason",
] as const satisfies ReadonlyArray<keyof DynamicDependencyEvidence>;
const EVIDENCE_NUMBER_FIELDS = [
  "startLine",
  "startColumn",
] as const satisfies ReadonlyArray<keyof DynamicDependencyEvidence>;
const EVIDENCE_OPTIONAL_STRING_FIELDS = [
  "literalPrefix",
  "literalSuffix",
] as const satisfies ReadonlyArray<keyof DynamicDependencyEvidence>;

function isStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/** Shape check for one persisted record: every field the impact read path dereferences. */
function isEvidenceRecord(value: unknown): value is DynamicDependencyEvidence {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    EVIDENCE_STRING_FIELDS.every(
      (field) => typeof record[field] === "string",
    ) &&
    EVIDENCE_NUMBER_FIELDS.every(
      (field) => typeof record[field] === "number",
    ) &&
    EVIDENCE_OPTIONAL_STRING_FIELDS.every(
      (field) =>
        record[field] === undefined || typeof record[field] === "string",
    ) &&
    DYNAMIC_DEPENDENCY_STATUS_VALUES.has(record.status) &&
    isStringArray(record.candidatePaths)
  );
}

function isProjectSourceFile(filePath: string): boolean {
  return PROJECT_SOURCE_EXTENSIONS.has(path.posix.extname(filePath));
}

function unavailable(
  reason: DynamicEvidenceUnavailableReason,
): DynamicDependencyEvidenceState {
  return { state: DynamicEvidenceAvailabilityStates.UNAVAILABLE, reason };
}

function parseEvidencePayload(raw: string): DynamicDependencyEvidenceState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unavailable(DynamicEvidenceUnavailableReasons.CORRUPT_JSON);
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as Record<string, unknown>).state ===
      DynamicEvidenceAvailabilityStates.UNAVAILABLE &&
    (parsed as Record<string, unknown>).reason ===
      DynamicEvidenceUnavailableReasons.INCOMPLETE_SCAN
  ) {
    return unavailable(DynamicEvidenceUnavailableReasons.INCOMPLETE_SCAN);
  }
  if (!Array.isArray(parsed)) {
    return unavailable(DynamicEvidenceUnavailableReasons.NOT_ARRAY);
  }
  // Never partially trusted: one invalid record makes the whole set unavailable.
  if (!parsed.every(isEvidenceRecord)) {
    return unavailable(DynamicEvidenceUnavailableReasons.INVALID_RECORD);
  }
  return {
    state: DynamicEvidenceAvailabilityStates.AVAILABLE,
    items: sortEvidence(parsed),
  };
}

/**
 * Issue #508 Phase 2 (D1/D5): reads the persisted evidence without ever converting a corrupt,
 * wrong-shaped or missing set into "no runtime imports". A missing row is only benign when no
 * JS/TS source is tracked at all (nothing could contain an `import()`); otherwise it means the
 * evidence was never computed for this database (e.g. it was rebuilt by a knowledge-branch
 * hydrate, which does not carry this row).
 */
export function readDynamicDependencyEvidenceState(
  store: IGraphStore,
  projectId: number,
): DynamicDependencyEvidenceState {
  const raw = store.meta.get(metaKey(projectId));
  if (raw !== undefined) return parseEvidencePayload(raw);
  const tracksSources = store.files
    .getAllHashes()
    .some(({ filePath }) =>
      isProjectSourceFile(normalizeWorkspacePath(filePath)),
    );
  return tracksSources
    ? unavailable(DynamicEvidenceUnavailableReasons.MISSING)
    : { state: DynamicEvidenceAvailabilityStates.AVAILABLE, items: [] };
}

/** Compatibility accessor: the trusted evidence set, or `[]` when it is unavailable. Callers that
 *  report confidence must use `readDynamicDependencyEvidenceState` instead. */
export function readDynamicDependencyEvidence(
  store: IGraphStore,
  projectId: number,
): DynamicDependencyEvidence[] {
  const evidence = readDynamicDependencyEvidenceState(store, projectId);
  return evidence.state === DynamicEvidenceAvailabilityStates.AVAILABLE
    ? evidence.items
    : [];
}

/** Project-wide availability of the persisted evidence (`IImpactService` contract shape). */
export function dynamicEvidenceAvailability(
  store: IGraphStore,
): DynamicEvidenceAvailability {
  const projectId = store.projects.getFirst()?.id;
  if (!projectId) return { state: DynamicEvidenceAvailabilityStates.AVAILABLE };
  const evidence = readDynamicDependencyEvidenceState(store, projectId);
  return evidence.state === DynamicEvidenceAvailabilityStates.AVAILABLE
    ? { state: DynamicEvidenceAvailabilityStates.AVAILABLE }
    : evidence;
}

interface DynamicEvidenceFileScan {
  items: DynamicDependencyEvidence[];
  incomplete: boolean;
}

function scanDynamicEvidenceFile(
  workspaceRoot: string,
  file: string,
  knownFiles: string[],
): DynamicEvidenceFileScan {
  const readResult = readFileWithinRootResult(workspaceRoot, file);
  if (readResult.status === ReadFileWithinRootStatuses.MISSING) {
    return { items: [], incomplete: false };
  }
  if (readResult.status !== ReadFileWithinRootStatuses.READABLE) {
    return { items: [], incomplete: true };
  }

  return {
    incomplete: false,
    items: scanDynamicImports(readResult.source).map((scanned) => ({
      sourceFile: normalizeWorkspacePath(file),
      kind: DynamicDependencyKinds.DYNAMIC_IMPORT,
      expression: scanned.expression,
      startLine: scanned.startLine,
      startColumn: scanned.startColumn,
      ...(scanned.literalPrefix !== undefined
        ? { literalPrefix: scanned.literalPrefix }
        : {}),
      ...(scanned.literalSuffix !== undefined
        ? { literalSuffix: scanned.literalSuffix }
        : {}),
      ...resolveCandidates(file, scanned, knownFiles),
    })),
  };
}

/**
 * Replaces evidence for the files in this parse batch while retaining other files' rows. When the
 * previous set is unavailable (#508 D1/D5) nothing is retained and every tracked source is
 * rescanned, so an incremental batch heals the set instead of laundering it into an "available"
 * but partial one.
 */
export function persistDynamicDependencyEvidence(
  store: IGraphStore,
  workspaceRoot: string,
  projectId: number,
  parsedResults: ParsedAstFileResult[],
): void {
  const previous = readDynamicDependencyEvidenceState(store, projectId);
  const knownFiles = store.files
    .getAllHashes()
    .map(({ filePath }) => normalizeWorkspacePath(filePath))
    .sort((a, b) => a.localeCompare(b));
  const filesToScan =
    previous.state === DynamicEvidenceAvailabilityStates.AVAILABLE
      ? parsedResults.map((result) => result.file)
      : knownFiles;
  const replacedFiles = new Set(filesToScan);
  // #508 D2: retained records are re-resolved against the current file universe -- a candidate
  // file added (or a 65th one crossing MAX_BOUNDED_CANDIDATES) without its loader being
  // re-parsed must not leave a stale bounded set behind.
  const retained =
    previous.state === DynamicEvidenceAvailabilityStates.AVAILABLE
      ? previous.items
          .filter((item) => !replacedFiles.has(item.sourceFile))
          .map((item) => ({
            ...item,
            ...resolveCandidates(
              item.sourceFile,
              scannedFromEvidence(item),
              knownFiles,
            ),
          }))
      : [];
  const fresh: DynamicDependencyEvidence[] = [];
  let scanIncomplete = false;

  for (const file of filesToScan) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const scan = scanDynamicEvidenceFile(workspaceRoot, file, knownFiles);
    scanIncomplete ||= scan.incomplete;
    fresh.push(...scan.items);
  }

  if (scanIncomplete) {
    store.meta.set(
      metaKey(projectId),
      JSON.stringify({
        state: DynamicEvidenceAvailabilityStates.UNAVAILABLE,
        reason: DynamicEvidenceUnavailableReasons.INCOMPLETE_SCAN,
      }),
    );
    return;
  }

  store.meta.set(
    metaKey(projectId),
    JSON.stringify(sortEvidence([...retained, ...fresh])),
  );
}

/** Target-relevant bounded evidence plus unresolved evidence whose pattern can still name target. */
export function dynamicEvidenceForTarget(
  store: IGraphStore,
  target: string,
): DynamicDependencyEvidence[] {
  const projectId = store.projects.getFirst()?.id;
  const node = store.graph.findNodeByName(target);
  if (!projectId || !node?.filePath) return [];
  const targetFile = normalizeWorkspacePath(node.filePath);
  // Unavailable evidence yields no records here; `dynamicEvidenceAvailability` reports it.
  return readDynamicDependencyEvidence(store, projectId).filter((item) => {
    if (item.candidatePaths.includes(targetFile)) return true;
    if (item.status !== DynamicDependencyStatuses.UNRESOLVED) return false;
    return patternCouldMatchTarget(
      item.sourceFile,
      scannedFromEvidence(item),
      targetFile,
    );
  });
}
