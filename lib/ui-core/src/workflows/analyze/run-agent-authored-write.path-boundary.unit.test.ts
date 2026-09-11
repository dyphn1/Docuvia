import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockLogger } from "@workspace/contracts";
import { runAgentAuthoredWrite } from "./run-agent-authored-write.js";
import type { ExtractedDecision } from "./analyze-result.js";

const oneDecision: ExtractedDecision[] = [
  {
    title: "Outside decision",
    nodeType: "decision",
    content: "Must never be anchored outside the workspace.",
    confidence: 1,
  },
];

describe("runAgentAuthoredWrite path boundary", () => {
  let workspaceRoot: string;
  let outsideRoot: string;
  let outsideFile: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-agent-authored-workspace-"),
    );
    outsideRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-agent-authored-outside-"),
    );
    outsideFile = path.join(outsideRoot, "secret.ts");
    fs.writeFileSync(outsideFile, "export const secret = true;\n");
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  it("rejects a ../ target before accepting an existing outside file", async () => {
    const escapedTarget = path.relative(workspaceRoot, outsideFile);
    expect(escapedTarget.startsWith(".." + path.sep)).toBe(true);

    await expect(
      runAgentAuthoredWrite({
        workspaceRoot,
        logger: createMockLogger(),
        targetPath: escapedTarget,
        decisions: oneDecision,
      }),
    ).rejects.toThrow(`Path does not exist: ${escapedTarget}`);
  });

  it("rejects an absolute target outside the workspace", async () => {
    await expect(
      runAgentAuthoredWrite({
        workspaceRoot,
        logger: createMockLogger(),
        targetPath: outsideFile,
        decisions: oneDecision,
      }),
    ).rejects.toThrow(`Path does not exist: ${outsideFile}`);
  });
});
