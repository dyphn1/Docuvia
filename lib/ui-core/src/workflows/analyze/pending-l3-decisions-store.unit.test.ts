import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockLogger, ErrorCodes } from "@workspace/contracts";
import { ANALYZE_MESSAGES } from "./analyze-messages.js";
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

/** Writes a real parseable source file under `root` so `stagePendingDecisions`'s roadmap-item-37
 *  anchor-feasibility validation (target must exist and, for single files, be a parseable source
 *  file) passes. */
function writeSourceFile(root: string, relPath: string): void {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "export const x = 1;\n");
}

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
      writeSourceFile(tmpDir, "src/sample.ts");
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
      writeSourceFile(tmpDir, "src\\nested\\sample.ts");
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
      writeSourceFile(tmpDir, "src/a.ts");
      writeSourceFile(tmpDir, "src/b.ts");
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
      writeSourceFile(tmpDir, "src/a.ts");
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
      writeSourceFile(tmpDir, "src/a.ts");
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
      writeSourceFile(tmpDir, "src/a.ts");
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

    it("refuses to stage on a nonexistent path (PATH_NOT_FOUND, matching the direct path)", async () => {
      await expect(
        stagePendingDecisions(
          tmpDir,
          "missing.ts",
          oneDecision,
          createMockLogger(),
        ),
      ).rejects.toMatchObject({ code: ErrorCodes.FS_READ_FAILED });
    });

    it("refuses to stage on a single non-source file that can never be anchored", async () => {
      fs.writeFileSync(path.join(tmpDir, "notes.md"), "# a note\n");
      await expect(
        stagePendingDecisions(
          tmpDir,
          "notes.md",
          oneDecision,
          createMockLogger(),
        ),
      ).rejects.toThrow(
        ANALYZE_MESSAGES.AGENT_AUTHORED_ANCHOR_UNRESOLVABLE("notes.md"),
      );
    });

    it("still stages on a directory target even with no source files inside (lenient by design)", async () => {
      fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "docs", "guide.md"), "# guide\n");
      const result = await stagePendingDecisions(
        tmpDir,
        "docs",
        oneDecision,
        createMockLogger(),
      );
      expect(result).toEqual({ staged: 1 });
    });
  });

  describe("writePendingDecisions()", () => {
    it("wholesale-rewrites the staging file to exactly the given array", async () => {
      writeSourceFile(tmpDir, "src/a.ts");
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
