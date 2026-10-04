import { describe, expect, it } from "vitest";
import { createPortableCallSiteKey } from "./call-site-identity.js";

describe("portable call-site identity", () => {
  it("[happy] hashes the versioned POSIX source identity with UTF-16 coordinates", () => {
    expect(
      createPortableCallSiteKey({
        filePath: "src/app.ts",
        sourceContentHash: "d".repeat(64),
        startLine: 3,
        startColumn: 5,
        calleeKind: "member",
        calleeName: "save",
      }),
    ).toBe(
      "call-site:v1:3d40ba02cc234fdd9a5b7c93f5efce69c83366cb0f1bf9bba61a8d190502e2b8",
    );
  });

  it("[happy] changes identity when the source version or callee identity changes", () => {
    const original = {
      filePath: "src/app.ts",
      sourceContentHash: "d".repeat(64),
      startLine: 3,
      startColumn: 5,
      calleeKind: "member" as const,
      calleeName: "save",
    };

    for (const change of [
      { filePath: "src/other.ts" },
      { sourceContentHash: "e".repeat(64) },
      { startLine: 4 },
      { startColumn: 6 },
      { calleeKind: "bare" as const },
      { calleeName: "remove" },
    ]) {
      expect(createPortableCallSiteKey(original)).not.toBe(
        createPortableCallSiteKey({ ...original, ...change }),
      );
    }
  });

  it("[happy] normalizes equivalent workspace-relative POSIX paths", () => {
    const input = {
      filePath: "src/app.ts",
      sourceContentHash: "d".repeat(64),
      startLine: 3,
      startColumn: 5,
      calleeKind: "member" as const,
      calleeName: "save",
    };

    const key = createPortableCallSiteKey(input);
    for (const filePath of [
      "./src/app.ts",
      "src//app.ts",
      "src/lib/../app.ts",
    ]) {
      expect(createPortableCallSiteKey({ ...input, filePath })).toBe(key);
    }
  });

  it("[happy] keeps astral-prefix callee columns in UTF-16 code units", () => {
    const source = "😀client.save()";
    const utf16Column = source.indexOf("save");
    const codePointColumn = Array.from(source.slice(0, utf16Column)).length;
    const input = {
      filePath: "src/app.ts",
      sourceContentHash: "d".repeat(64),
      startLine: 0,
      startColumn: utf16Column,
      calleeKind: "member" as const,
      calleeName: "save",
    };

    expect(utf16Column).toBe(9);
    expect(codePointColumn).toBe(8);
    expect(createPortableCallSiteKey(input)).toBe(
      createPortableCallSiteKey({ ...input, startColumn: 9 }),
    );
    expect(createPortableCallSiteKey(input)).not.toBe(
      createPortableCallSiteKey({ ...input, startColumn: codePointColumn }),
    );
  });

  it("[invalid-input] rejects paths that escape or are not POSIX workspace paths", () => {
    for (const filePath of [
      "/src/app.ts",
      "../outside.ts",
      "src/../../outside.ts",
      "C:/src/app.ts",
      "src\\app.ts",
      "src/\u0000app.ts",
    ]) {
      expect(() =>
        createPortableCallSiteKey({
          filePath,
          sourceContentHash: "d".repeat(64),
          startLine: 0,
          startColumn: 0,
          calleeKind: "bare",
          calleeName: "run",
        }),
      ).toThrow(/workspace-relative POSIX path/);
    }
  });

  it("[error-handling] rejects missing or malformed source coordinates and callee evidence", () => {
    expect(() =>
      createPortableCallSiteKey({
        filePath: "src/app.ts",
        sourceContentHash: "not-a-sha",
        startLine: 0,
        startColumn: 0,
        calleeKind: "bare",
        calleeName: "run",
      }),
    ).toThrow(/source content hash/);
    expect(() =>
      createPortableCallSiteKey({
        filePath: "src/app.ts",
        sourceContentHash: "d".repeat(64),
        startLine: -1,
        startColumn: 0,
        calleeKind: "bare",
        calleeName: "run",
      }),
    ).toThrow(/zero-based/);
    expect(() =>
      createPortableCallSiteKey({
        filePath: "src/app.ts",
        sourceContentHash: "d".repeat(64),
        startLine: 0,
        startColumn: 0,
        calleeKind: "bare",
        calleeName: "",
      }),
    ).toThrow(/callee name/);
  });
});
