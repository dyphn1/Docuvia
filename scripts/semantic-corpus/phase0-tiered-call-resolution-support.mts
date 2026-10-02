import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

const CALL_SITE_KEY_VERSION = "v1";
const CALL_SITE_KEY_SEPARATOR = "\0";

export interface PortableCallSiteKeyInput {
  readonly filePath: string;
  /** SHA-256 of the exact file bytes, before any newline or encoding normalization. */
  readonly fileContentHash: string;
  readonly row: number;
  /** Zero-based UTF-16 code-unit column from AstWorker/corpus call-site positions. */
  readonly columnUtf16: number;
  readonly calleeKind: string;
  readonly calleeName: string;
}

export interface MappedCallSitePosition {
  readonly row: number;
  readonly columnUtf16: number;
  readonly offsetUtf16: number;
}

export type CallSitePositionMapping =
  | {
      readonly status: "unique";
      readonly position: MappedCallSitePosition;
      readonly callExpression: ts.CallExpression;
    }
  | {
      readonly status: "excluded";
      readonly reason:
        | "source-text-mismatch"
        | "invalid-row"
        | "invalid-column"
        | "no-call-at-position"
        | "multiple-calls-at-position";
      readonly position?: MappedCallSitePosition;
    };

/** Versioned, workspace-portable identity. Database ids, checkout roots and project ids do not
 *  participate; changing the file bytes or callee position produces a new key. */
export function portableCallSiteKey(input: PortableCallSiteKeyInput): string {
  const filePath = normalizeWorkspaceRelativePath(input.filePath);
  if (!/^[a-f0-9]{64}$/i.test(input.fileContentHash))
    throw new Error("Call-site content hash must be a SHA-256 hex digest.");
  if (!Number.isSafeInteger(input.row) || input.row < 0)
    throw new Error("Call-site row must be a non-negative integer.");
  if (!Number.isSafeInteger(input.columnUtf16) || input.columnUtf16 < 0)
    throw new Error("Call-site UTF-16 column must be a non-negative integer.");
  if (!input.calleeKind.trim() || !input.calleeName.trim())
    throw new Error("Call-site callee kind and name must be non-empty.");

  const digest = createHash("sha256")
    .update(
      [
        CALL_SITE_KEY_VERSION,
        filePath,
        input.fileContentHash.toLowerCase(),
        String(input.row),
        String(input.columnUtf16),
        input.calleeKind,
        input.calleeName,
      ].join(CALL_SITE_KEY_SEPARATOR),
      "utf8",
    )
    .digest("hex");
  return `${CALL_SITE_KEY_VERSION}:${digest}`;
}

/** Maps an AstWorker/corpus UTF-16 column to a TypeScript source offset, then selects the
 *  innermost call expression whose callee contains that exact position. */
export function mapCallExpressionAtPosition(
  sourceFile: ts.SourceFile,
  sourceText: string,
  row: number,
  columnUtf16: number,
): CallSitePositionMapping {
  if (sourceFile.text !== sourceText)
    return { status: "excluded", reason: "source-text-mismatch" };
  if (!Number.isSafeInteger(row) || row < 0)
    return { status: "excluded", reason: "invalid-row" };
  if (!Number.isSafeInteger(columnUtf16) || columnUtf16 < 0)
    return { status: "excluded", reason: "invalid-column" };

  const lines = sourceText.split(/\r\n|\n|\r/);
  const lineText = lines[row];
  if (lineText === undefined)
    return { status: "excluded", reason: "invalid-row" };
  if (columnUtf16 > lineText.length)
    return { status: "excluded", reason: "invalid-column" };
  let offsetUtf16: number;
  try {
    offsetUtf16 = sourceFile.getPositionOfLineAndCharacter(row, columnUtf16);
  } catch {
    return { status: "excluded", reason: "invalid-column" };
  }
  const position = { row, columnUtf16, offsetUtf16 };
  const matchingCalls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      offsetUtf16 >= node.expression.getStart(sourceFile) &&
      offsetUtf16 < node.expression.getEnd()
    )
      matchingCalls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (matchingCalls.length === 0)
    return { status: "excluded", reason: "no-call-at-position", position };

  matchingCalls.sort(
    (left, right) => left.getWidth(sourceFile) - right.getWidth(sourceFile),
  );
  const smallestWidth = matchingCalls[0].getWidth(sourceFile);
  const innermost = matchingCalls.filter(
    (call) => call.getWidth(sourceFile) === smallestWidth,
  );
  if (innermost.length !== 1)
    return {
      status: "excluded",
      reason: "multiple-calls-at-position",
      position,
    };
  return {
    status: "unique",
    position,
    callExpression: innermost[0],
  };
}

function normalizeWorkspaceRelativePath(filePath: string): string {
  const posixPath = filePath.replaceAll("\\", "/");
  if (
    posixPath.startsWith("/") ||
    /^[a-zA-Z]:\//.test(posixPath) ||
    posixPath.split("/").includes("..")
  )
    throw new Error("Call-site path must be workspace-relative.");
  const normalized = path.posix.normalize(posixPath);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../"))
    throw new Error("Call-site path must be workspace-relative.");
  return normalized;
}
