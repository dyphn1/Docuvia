import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { appendInitLogLine, writeInitSummary } from "./init-log-writer.js";

function readLines(logPath: string): unknown[] {
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe("init-log-writer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-init-log-writer-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .docuvia/logs/init.log with a valid summary line when failures occur", async () => {
    const summary = {
      filesRequested: 5,
      filesParsed: 4,
      filesFailed: 1,
      failures: [
        { file: "src/broken.ts", hash: "h1", error: "Unexpected token" },
      ],
    };

    await writeInitSummary(tmpDir, summary);

    const logPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    expect(fs.existsSync(logPath)).toBe(true);

    const lines = readLines(logPath) as Array<Record<string, unknown>>;
    const last = lines[lines.length - 1];
    expect(last.event).toBe("init.summary");
    expect(last.ts).toEqual(expect.any(String));
    expect(last.filesRequested).toBe(5);
    expect(last.filesParsed).toBe(4);
    expect(last.filesFailed).toBe(1);
    expect(last.failures).toEqual(summary.failures);
  });

  it("appends rather than truncates across multiple invocations", async () => {
    await appendInitLogLine(tmpDir, {
      event: "init.start",
      workspaceRoot: tmpDir,
    });
    await appendInitLogLine(tmpDir, {
      event: "init.parse_failure",
      file: "src/a.ts",
      hash: "h",
      error: "boom",
    });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    const lines = readLines(logPath) as Array<Record<string, unknown>>;

    expect(lines.length).toBe(2);
    expect(lines[0].event).toBe("init.start");
    expect(lines[1].event).toBe("init.parse_failure");
    expect(lines[1].file).toBe("src/a.ts");
  });
});
