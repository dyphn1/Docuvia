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
  /** Tree-sitter's zero-based UTF-8 byte column used by the stored Tier A call-site row. */
  readonly columnByte: number;
  readonly calleeKind: string;
  readonly calleeName: string;
}

export interface MappedCallSitePosition {
  readonly row: number;
  readonly columnByte: number;
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
        | "column-splits-utf8-codepoint"
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
  if (!Number.isSafeInteger(input.columnByte) || input.columnByte < 0)
    throw new Error("Call-site byte column must be a non-negative integer.");
  if (!input.calleeKind.trim() || !input.calleeName.trim())
    throw new Error("Call-site callee kind and name must be non-empty.");

  const digest = createHash("sha256")
    .update(
      [
        CALL_SITE_KEY_VERSION,
        filePath,
        input.fileContentHash.toLowerCase(),
        String(input.row),
        String(input.columnByte),
        input.calleeKind,
        input.calleeName,
      ].join(CALL_SITE_KEY_SEPARATOR),
      "utf8",
    )
    .digest("hex");
  return `${CALL_SITE_KEY_VERSION}:${digest}`;
}

/** Maps Tree-sitter's UTF-8 byte column to the UTF-16 offset used by TypeScript AST/LSP APIs,
 *  then selects the innermost call expression whose callee contains that exact position. */
export function mapCallExpressionAtBytePosition(
  sourceFile: ts.SourceFile,
  sourceText: string,
  row: number,
  columnByte: number,
): CallSitePositionMapping {
  if (sourceFile.text !== sourceText)
    return { status: "excluded", reason: "source-text-mismatch" };
  if (!Number.isSafeInteger(row) || row < 0)
    return { status: "excluded", reason: "invalid-row" };
  if (!Number.isSafeInteger(columnByte) || columnByte < 0)
    return { status: "excluded", reason: "invalid-column" };

  const lines = sourceText.split(/\r\n|\n|\r/);
  const lineText = lines[row];
  if (lineText === undefined)
    return { status: "excluded", reason: "invalid-row" };
  const lineBytes = Buffer.from(lineText, "utf8");
  if (columnByte > lineBytes.length)
    return { status: "excluded", reason: "invalid-column" };
  const bytePrefix = lineBytes.subarray(0, columnByte);
  const prefixText = bytePrefix.toString("utf8");
  if (!Buffer.from(prefixText, "utf8").equals(bytePrefix))
    return {
      status: "excluded",
      reason: "column-splits-utf8-codepoint",
    };

  const columnUtf16 = prefixText.length;
  let offsetUtf16: number;
  try {
    offsetUtf16 = sourceFile.getPositionOfLineAndCharacter(row, columnUtf16);
  } catch {
    return { status: "excluded", reason: "invalid-column" };
  }
  const position = { row, columnByte, columnUtf16, offsetUtf16 };
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
