import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  mapCallExpressionAtBytePosition,
  portableCallSiteKey,
  type PortableCallSiteKeyInput,
} from "../../scripts/semantic-corpus/phase0-tiered-call-resolution-support.mts";

const keyInput = (
  overrides: Partial<PortableCallSiteKeyInput> = {},
): PortableCallSiteKeyInput => ({
  filePath: "src/caller.ts",
  fileContentHash: "a".repeat(64),
  row: 4,
  columnByte: 12,
  calleeKind: "member",
  calleeName: "run",
  ...overrides,
});

describe("Phase 0 portable call-site mapping", () => {
  it("[happy] keys a site from its relative path, exact content version, position and callee", () => {
    const first = portableCallSiteKey(keyInput());

    expect(first).toMatch(/^v1:[a-f0-9]{64}$/);
    expect(portableCallSiteKey(keyInput())).toBe(first);
    expect(
      portableCallSiteKey(keyInput({ fileContentHash: "b".repeat(64) })),
    ).not.toBe(first);
    expect(portableCallSiteKey(keyInput({ columnByte: 13 }))).not.toBe(first);
  });

  it("maps duplicate call expressions by the exact UTF-8 byte position", () => {
    const text = "const label = '😀'; service.run(); service.run();";
    const sourceFile = ts.createSourceFile(
      "caller.ts",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const secondCallee = text.lastIndexOf("service.run");
    const columnByte = Buffer.byteLength(text.slice(0, secondCallee), "utf8");

    const mapped = mapCallExpressionAtBytePosition(
      sourceFile,
      text,
      0,
      columnByte,
    );

    expect(mapped.status).toBe("unique");
    if (mapped.status !== "unique") return;
    expect(mapped.position.columnByte).toBeGreaterThan(
      mapped.position.columnUtf16,
    );
    expect(mapped.callExpression.expression.getStart(sourceFile)).toBe(
      secondCallee,
    );
  });

  it("returns an explicit exclusion when a position is not inside a callee", () => {
    const text = "service.run();";
    const sourceFile = ts.createSourceFile(
      "caller.ts",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const mapped = mapCallExpressionAtBytePosition(
      sourceFile,
      text,
      0,
      Buffer.byteLength("service.run", "utf8"),
    );

    expect(mapped).toMatchObject({
      status: "excluded",
      reason: "no-call-at-position",
    });
  });

  it("[invalid-input] rejects workspace-absolute paths and non-SHA-256 content hashes", () => {
    expect(() =>
      portableCallSiteKey(keyInput({ filePath: "/repo/src/a.ts" })),
    ).toThrow(/workspace-relative/);
    expect(() =>
      portableCallSiteKey(keyInput({ fileContentHash: "short" })),
    ).toThrow(/SHA-256/);
  });

  it("[error-handling] excludes a source file that no longer matches the measured text", () => {
    const sourceFile = ts.createSourceFile(
      "caller.ts",
      "service.run();",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    expect(
      mapCallExpressionAtBytePosition(sourceFile, "other.run();", 0, 0),
    ).toEqual({
      status: "excluded",
      reason: "source-text-mismatch",
    });
  });
});
