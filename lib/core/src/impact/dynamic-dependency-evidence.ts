import * as path from "path";
import {
  DynamicDependencyKinds,
  DynamicDependencyStatuses,
  type DynamicDependencyEvidence,
  type IGraphStore,
  type ParsedAstFileResult,
} from "@workspace/contracts";
import { readFileWithinRoot } from "../utils/safe-fs.js";

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

interface ScannedDynamicImport {
  expression: string;
  startLine: number;
  startColumn: number;
  literalPrefix?: string;
  literalSuffix?: string;
  interpolated: boolean;
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

function findClosingParen(source: string, openIndex: number): number | undefined {
  let depth = 1;
  let i = openIndex + 1;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuoted(source, i, ch);
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return undefined;
}

function sourcePosition(source: string, index: number): { line: number; column: number } {
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
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuoted(source, i, ch);
      continue;
    }

    if (
      source.startsWith("import", i) &&
      !isIdentifierChar(source[i - 1]) &&
      !isIdentifierChar(source[i + 6])
    ) {
      let open = i + 6;
      while (/\s/.test(source[open] ?? "")) open++;
      if (source[open] === "(") {
        const close = findClosingParen(source, open);
        if (close !== undefined) {
          const raw = source.slice(open + 1, close);
          const leadingWhitespace = raw.length - raw.trimStart().length;
          const expression = raw.trim();
          if (expression.length > 0) {
            const expressionStart = open + 1 + leadingWhitespace;
            const position = sourcePosition(source, expressionStart);
            result.push({
              expression,
              startLine: position.line,
              startColumn: position.column,
              ...literalParts(expression),
            });
          }
          i = close + 1;
          continue;
        }
      }
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

function resolveLocalPatternPrefix(
  sourceFile: string,
  literalPrefix: string | undefined,
): string | undefined {
  if (!literalPrefix?.startsWith(".")) return undefined;
  const sourceDir = path.posix.dirname(normalizeWorkspacePath(sourceFile));
  const normalized = path.posix.normalize(
    path.posix.join(sourceDir, normalizeWorkspacePath(literalPrefix)),
  );
  return literalPrefix.endsWith("/") ? `${normalized}/` : normalized;
}

function patternCouldMatchTarget(
  sourceFile: string,
  scanned: Pick<ScannedDynamicImport, "literalPrefix" | "literalSuffix" | "interpolated">,
  targetFile: string,
): boolean {
  const prefix = resolveLocalPatternPrefix(sourceFile, scanned.literalPrefix);
  if (!prefix) return !scanned.literalPrefix;
  const target = normalizeWorkspacePath(targetFile);
  const targetStem = stripProjectExtension(target);
  if (!scanned.interpolated) {
    return target === prefix || targetStem === prefix;
  }
  return (
    targetStem.startsWith(prefix) &&
    targetStem.endsWith(scanned.literalSuffix ?? "")
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

function sortEvidence(items: DynamicDependencyEvidence[]): DynamicDependencyEvidence[] {
  return items.sort(
    (a, b) =>
      a.sourceFile.localeCompare(b.sourceFile) ||
      a.startLine - b.startLine ||
      a.startColumn - b.startColumn ||
      a.expression.localeCompare(b.expression),
  );
}

export function readDynamicDependencyEvidence(
  store: IGraphStore,
  projectId: number,
): DynamicDependencyEvidence[] {
  const raw = store.meta.get(metaKey(projectId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DynamicDependencyEvidence[];
    return Array.isArray(parsed) ? sortEvidence(parsed) : [];
  } catch {
    return [];
  }
}

/** Replaces evidence for the files in this parse batch while retaining other files' rows. */
export function persistDynamicDependencyEvidence(
  store: IGraphStore,
  workspaceRoot: string,
  projectId: number,
  parsedResults: ParsedAstFileResult[],
): void {
  const replacedFiles = new Set(parsedResults.map((result) => result.file));
  const retained = readDynamicDependencyEvidence(store, projectId).filter(
    (item) => !replacedFiles.has(item.sourceFile),
  );
  const knownFiles = store.files
    .getAllHashes()
    .map(({ filePath }) => normalizeWorkspacePath(filePath))
    .sort((a, b) => a.localeCompare(b));
  const fresh: DynamicDependencyEvidence[] = [];

  for (const result of parsedResults) {
    if (!/\.[cm]?[jt]sx?$/.test(result.file)) continue;
    const source = readFileWithinRoot(workspaceRoot, result.file);
    if (source === null) continue;
    for (const scanned of scanDynamicImports(source)) {
      fresh.push({
        sourceFile: normalizeWorkspacePath(result.file),
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
        ...resolveCandidates(result.file, scanned, knownFiles),
      });
    }
  }

  store.meta.set(metaKey(projectId), JSON.stringify(sortEvidence([...retained, ...fresh])));
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
  return readDynamicDependencyEvidence(store, projectId).filter((item) => {
    if (item.candidatePaths.includes(targetFile)) return true;
    if (item.status !== DynamicDependencyStatuses.UNRESOLVED) return false;
    return patternCouldMatchTarget(
      item.sourceFile,
      {
        literalPrefix: item.literalPrefix,
        literalSuffix: item.literalSuffix,
        interpolated: item.expression.startsWith("`") && item.expression.includes("${"),
      },
      targetFile,
    );
  });
}
