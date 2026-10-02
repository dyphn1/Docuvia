import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ts from "typescript";
import { AstWorkerPool } from "../../lib/core/src/ast/ast-worker-pool.js";
import {
  createPartialSemanticProject,
  type PartialSemanticCallSite,
} from "../../scripts/semantic-corpus/phase0-partial-semantic.mts";
import {
  mapCallExpressionAtPosition,
  portableCallSiteKey,
} from "../../scripts/semantic-corpus/phase0-tiered-call-resolution-support.mts";
import {
  resolveSystem1DeterministicQueries,
  System1QuerySourceIndex,
  type System1QueryState,
} from "../../scripts/semantic-corpus/system1-query-routing-rules.mts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("Phase 0 UTF-16 worker call-site positions", () => {
  it("[integration] preserves an astral-prefixed worker position through mapping, Q1 and PartialSemantic", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-phase0-utf16-position-"),
    );
    temporaryRoots.push(root);
    const callerFile = "src/caller.ts";
    const targetFile = "src/targets.ts";
    const callerText = [
      'import { a } from "./targets";',
      'export function caller() { const marker = "😀"; a(); z(); }',
      "function z() {}",
    ].join("\n");
    const targetText = "export function a() {}\n";
    const projectText = JSON.stringify(
      {
        files: [callerFile, targetFile],
        compilerOptions: { target: "ES2020" },
      },
      null,
      2,
    );
    for (const [file, text] of [
      [callerFile, callerText],
      [targetFile, targetText],
      ["tsconfig.json", projectText],
    ] as const) {
      const absolute = path.join(root, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, text, "utf8");
    }

    const workerPool = new AstWorkerPool();
    await workerPool.initialize(1);
    const partialProject = createPartialSemanticProject({
      snapshotRoot: root,
      projectId: "tsconfig.json",
      snapshotFiles: new Set([callerFile, targetFile, "tsconfig.json"]),
    });
    try {
      const parsed = await workerPool.parse({
        filePath: path.join(root, callerFile),
        code: callerText,
        language: "typescript",
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data).toBeDefined();
      const workerCall = parsed.data!.calls!.find(
        (call) => call.calleeName === "a",
      )!;
      expect(workerCall).toBeDefined();

      const lineText = callerText.split("\n")[workerCall.startLine]!;
      expect(lineText).toBeDefined();
      const callOffset = callerText.indexOf(
        "a();",
        callerText.indexOf("marker"),
      );
      const lineStart = callerText.lastIndexOf("\n", callOffset) + 1;
      const workerColumn = callOffset - lineStart;
      const byteColumn = Buffer.byteLength(
        lineText.slice(0, workerCall.startColumn),
        "utf8",
      );
      expect(workerCall.startColumn).toBe(workerColumn);
      expect(byteColumn).toBeGreaterThan(workerCall.startColumn);

      const sourceFile = ts.createSourceFile(
        callerFile,
        callerText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const mapping = mapCallExpressionAtPosition(
        sourceFile,
        callerText,
        workerCall.startLine,
        workerCall.startColumn,
      );
      expect(mapping.status).toBe("unique");
      if (mapping.status !== "unique") return;
      expect(mapping.position.offsetUtf16).toBe(callOffset);
      expect(mapping.callExpression.expression.getText(sourceFile)).toBe("a");

      const manifestCallSite = {
        filePath: callerFile,
        line: workerCall.startLine,
        column: workerCall.startColumn,
      };
      const callSiteKey = portableCallSiteKey({
        filePath: callerFile,
        fileContentHash: crypto
          .createHash("sha256")
          .update(Buffer.from(callerText, "utf8"))
          .digest("hex"),
        row: manifestCallSite.line,
        columnUtf16: manifestCallSite.column,
        calleeKind: workerCall.calleeKind ?? "bare",
        calleeName: workerCall.calleeName ?? "a",
      });
      expect(callSiteKey).toMatch(/^v1:[a-f0-9]{64}$/);

      const state: System1QueryState = {
        request: {
          requestId: "utf16-astral-callsite",
          evidence: { projectId: "tsconfig.json" },
          context: {
            text: JSON.stringify({
              caller: { filePath: callerFile, symbol: "caller" },
              call: { kind: "bare", calleeName: "a", expression: "a()" },
              importBinding: {
                kind: "named",
                local: "a",
                imported: "a",
                sourceSpecifier: "./targets",
                pathAlias: false,
              },
            }),
          },
          options: [
            {
              id: "target-a",
              kind: "candidate",
              attributes: { targetId: `${targetFile}#a` },
            },
          ],
        },
      };
      const queryIndex = new System1QuerySourceIndex(
        root,
        new Set([callerFile, targetFile, "tsconfig.json"]),
      );
      const exactQuery = resolveSystem1DeterministicQueries(
        state,
        queryIndex,
        manifestCallSite,
      );
      expect(exactQuery.q1).toMatchObject({
        status: "commit",
        targetId: `${targetFile}#a`,
      });
      const oldByteQuery = resolveSystem1DeterministicQueries(
        state,
        queryIndex,
        { line: workerCall.startLine, column: byteColumn },
      );
      expect(oldByteQuery.q1.status).toBe("abstain");

      const partialSite: PartialSemanticCallSite = {
        filePath: callerFile,
        line: workerCall.startLine,
        column: workerCall.startColumn,
        offsetUtf16: mapping.position.offsetUtf16,
        calleeKind: workerCall.calleeKind ?? "bare",
        calleeName: workerCall.calleeName ?? "a",
        positionStatus: "unique",
      };
      const partialResult = partialProject.query(partialSite);
      expect(partialResult.status).toBe("resolved");
      expect(
        partialResult.definitions.some(
          (definition) =>
            definition.filePath === targetFile && definition.symbolName === "a",
        ),
      ).toBe(true);
      expect(
        partialProject.query({ ...partialSite, column: byteColumn }),
      ).toMatchObject({
        status: "invalid-position",
        reason: "callee-position-mismatch",
      });
    } finally {
      partialProject.close();
      await workerPool.terminate();
    }
  }, 120_000);
});
