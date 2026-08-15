import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockLogger } from "@workspace/contracts";
import {
  readPendingDecisions,
  stagePendingDecisions,
  writePendingDecisions,
} from "./pending-l3-decisions-store.js";
import type { ExtractedDecision } from "./analyze-result.js";

const oneDecision: ExtractedDecision[] = [
  {
    title: "Agent-authored decision",
    nodeType: "decision",
    content: "Written verbatim, no LLM call.",
    confidence: 0.9,
  },
];

describe("pending-l3-decisions-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-pending-l3-decisions-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readPendingDecisions()", () => {
    it("returns [] when no file exists", async () => {
      const decisions = await readPendingDecisions(tmpDir, createMockLogger());
      expect(decisions).toEqual([]);
    });

    it("warns and returns [] on corrupt JSON", async () => {
      const dir = path.join(tmpDir, ".docuvia");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "pending-l3-decisions.json"),
        "{ not json",
      );

      const logger = createMockLogger();
      const decisions = await readPendingDecisions(tmpDir, logger);

      expect(decisions).toEqual([]);
      expect(logger.events.some((e) => e.level === "warn")).toBe(true);
    });

    it("warns and returns [] when the top-level shape isn't { decisions: [...] }", async () => {
      const dir = path.join(tmpDir, ".docuvia");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "pending-l3-decisions.json"),
        JSON.stringify({ notDecisions: [] }),
      );

      const logger = createMockLogger();
      const decisions = await readPendingDecisions(tmpDir, logger);

      expect(decisions).toEqual([]);
      expect(logger.events.some((e) => e.level === "warn")).toBe(true);
    });
  });

  describe("stagePendingDecisions()", () => {
    it("appends one PendingL3Decision per input decision, node_key-normalized filePath", async () => {
      const result = await stagePendingDecisions(
        tmpDir,
        "src/sample.ts",
        oneDecision,
        createMockLogger(),
      );

      expect(result).toEqual({ staged: 1 });
      const stored = await readPendingDecisions(tmpDir, createMockLogger());
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        filePath: "src/sample.ts",
        title: "Agent-authored decision",
        content: "Written verbatim, no LLM call.",
        nodeType: "decision",
        confidence: 0.9,
      });
      expect(typeof stored[0].stagedAt).toBe("string");
    });

    it("normalizes a Windows-style backslash path to forward-slash node_key form", async () => {
      await stagePendingDecisions(
        tmpDir,
        "src\\nested\\sample.ts",
        oneDecision,
        createMockLogger(),
      );

      const stored = await readPendingDecisions(tmpDir, createMockLogger());
      expect(stored[0].filePath).toBe("src/nested/sample.ts");
    });

    it("accumulates across separate --stage calls without clobbering existing entries", async () => {
      await stagePendingDecisions(
        tmpDir,
        "src/a.ts",
        oneDecision,
        createMockLogger(),
      );
      await stagePendingDecisions(
        tmpDir,
        "src/b.ts",
        [{ ...oneDecision[0], title: "Second decision" }],
        createMockLogger(),
      );

      const stored = await readPendingDecisions(tmpDir, createMockLogger());
      expect(stored).toHaveLength(2);
      expect(stored.map((d) => d.filePath)).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("creates .docuvia/ when it doesn't exist yet", async () => {
      await stagePendingDecisions(
        tmpDir,
        "src/a.ts",
        oneDecision,
        createMockLogger(),
      );

      expect(
        fs.existsSync(
          path.join(tmpDir, ".docuvia", "pending-l3-decisions.json"),
        ),
      ).toBe(true);
    });

    it("self-heals from a corrupt existing file: next stage call starts fresh, doesn't crash", async () => {
      const dir = path.join(tmpDir, ".docuvia");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "pending-l3-decisions.json"),
        "not json at all",
      );

      await stagePendingDecisions(
        tmpDir,
        "src/a.ts",
        oneDecision,
        createMockLogger(),
      );

      const stored = await readPendingDecisions(tmpDir, createMockLogger());
      expect(stored).toHaveLength(1);
      expect(stored[0].filePath).toBe("src/a.ts");
    });

    it("staging multiple decisions in one call appends one entry per decision", async () => {
      const twoDecisions: ExtractedDecision[] = [
        oneDecision[0],
        { ...oneDecision[0], title: "Another decision" },
      ];

      const result = await stagePendingDecisions(
        tmpDir,
        "src/a.ts",
        twoDecisions,
        createMockLogger(),
      );

      expect(result).toEqual({ staged: 2 });
      const stored = await readPendingDecisions(tmpDir, createMockLogger());
      expect(stored).toHaveLength(2);
    });
  });

  describe("writePendingDecisions()", () => {
    it("wholesale-rewrites the staging file to exactly the given array", async () => {
      await stagePendingDecisions(
        tmpDir,
        "src/a.ts",
        oneDecision,
        createMockLogger(),
      );

      await writePendingDecisions(tmpDir, []);

      const stored = await readPendingDecisions(tmpDir, createMockLogger());
      expect(stored).toEqual([]);
    });
  });
});
