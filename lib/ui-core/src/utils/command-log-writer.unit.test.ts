import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { appendCommandLogLine } from "./command-log-writer.js";

function readLines(logPath: string): unknown[] {
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe("command-log-writer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-command-log-writer-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .docuvia/logs/<logFileName> (mkdir -p) on first write", async () => {
    await appendCommandLogLine(tmpDir, "status.log", { event: "status.start" });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "status.log");
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it("writes one JSON object per line, each with a ts field plus the given event fields", async () => {
    await appendCommandLogLine(tmpDir, "query.log", { event: "query.start", target: "foo" });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "query.log");
    const lines = readLines(logPath) as Array<Record<string, unknown>>;

    expect(lines.length).toBe(1);
    expect(lines[0].ts).toEqual(expect.any(String));
    expect(new Date(lines[0].ts as string).toString()).not.toBe("Invalid Date");
    expect(lines[0].event).toBe("query.start");
    expect(lines[0].target).toBe("foo");
  });

  it("appends rather than truncates across multiple invocations targeting the same log file", async () => {
    await appendCommandLogLine(tmpDir, "sync.log", { event: "sync.start", projectId: "1" });
    await appendCommandLogLine(tmpDir, "sync.log", { event: "sync.summary", synced: 3 });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "sync.log");
    const lines = readLines(logPath) as Array<Record<string, unknown>>;

    expect(lines.length).toBe(2);
    expect(lines[0].event).toBe("sync.start");
    expect(lines[1].event).toBe("sync.summary");
    expect(lines[1].synced).toBe(3);
  });

  it("keeps separate log files independent for different logFileName values", async () => {
    await appendCommandLogLine(tmpDir, "clean.log", { event: "clean.start" });
    await appendCommandLogLine(tmpDir, "status.log", { event: "status.start" });

    const cleanLines = readLines(path.join(tmpDir, ".docuvia", "logs", "clean.log"));
    const statusLines = readLines(path.join(tmpDir, ".docuvia", "logs", "status.log"));

    expect(cleanLines.length).toBe(1);
    expect(statusLines.length).toBe(1);
  });
});
