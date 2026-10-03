import { createHash } from "node:crypto";

export interface PortableCallSiteKeyInput {
  /** Workspace-relative path using POSIX separators. */
  readonly filePath: string;
  /** Lowercase SHA-256 hex digest of the exact file contents. */
  readonly sourceContentHash: string;
  /** Zero-based callee start position; column is measured in UTF-16 code units. */
  readonly startLine: number;
  readonly startColumn: number;
  readonly calleeKind: string;
  readonly calleeName: string;
}

export function createPortableCallSiteKey(
  input: PortableCallSiteKeyInput,
): string {
  const filePath = normalizeWorkspaceRelativePath(input.filePath);

  if (!/^[a-f0-9]{64}$/.test(input.sourceContentHash)) {
    throw new Error(
      "Call-site source content hash must be a lowercase SHA-256 hex digest",
    );
  }
  if (!Number.isSafeInteger(input.startLine) || input.startLine < 0) {
    throw new Error(
      "Call-site start line must be a non-negative zero-based integer",
    );
  }
  if (!Number.isSafeInteger(input.startColumn) || input.startColumn < 0) {
    throw new Error(
      "Call-site start column must be a non-negative zero-based integer",
    );
  }
  if (!isSafeIdentityPart(input.calleeKind)) {
    throw new Error(
      "Call-site callee kind must be a non-empty string without NUL bytes",
    );
  }
  if (!isSafeIdentityPart(input.calleeName)) {
    throw new Error(
      "Call-site callee name must be a non-empty string without NUL bytes",
    );
  }

  const digest = createHash("sha256")
    .update(
      [
        filePath,
        input.sourceContentHash,
        String(input.startLine),
        String(input.startColumn),
        input.calleeKind,
        input.calleeName,
      ].join("\0"),
      "utf8",
    )
    .digest("hex");

  return `call-site:v1:${digest}`;
}

function normalizeWorkspaceRelativePath(filePath: string): string {
  if (typeof filePath !== "string") {
    throw new Error("Call-site path must be a workspace-relative POSIX path");
  }
  const invalidPathForms = [
    filePath.length === 0,
    filePath.endsWith("/"),
    filePath.startsWith("/"),
    /^[a-zA-Z]:/.test(filePath),
    filePath.includes("\\"),
    filePath.includes("\0"),
  ];
  if (invalidPathForms.some(Boolean)) {
    throw new Error("Call-site path must be a workspace-relative POSIX path");
  }

  const segments: string[] = [];
  for (const segment of filePath.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    if (segments.length === 0) {
      throw new Error("Call-site path must be a workspace-relative POSIX path");
    }
    segments.pop();
  }

  if (segments.length === 0) {
    throw new Error("Call-site path must be a workspace-relative POSIX path");
  }

  return segments.join("/");
}

function isSafeIdentityPart(value: string): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.includes("\0")
  );
}
