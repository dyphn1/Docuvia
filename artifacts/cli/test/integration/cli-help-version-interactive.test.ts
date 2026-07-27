import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { TestSandbox } from "../support/sandbox.js";

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf-8"),
) as { version: string };

describe("docuvia --help / -h / --version / -v", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({ initGit: true });
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("prints usage and exits 0 for --help", async () => {
    const result = await sandbox.runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("docuvia init");
    expect(result.stdout).toContain("docuvia doctor");
  }, 15000);

  it("prints usage and exits 0 for -h", async () => {
    const result = await sandbox.runCli(["-h"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
  }, 15000);

  it("prints the installed version and exits 0 for --version", async () => {
    const result = await sandbox.runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  }, 15000);

  it("prints the installed version and exits 0 for -v", async () => {
    const result = await sandbox.runCli(["-v"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  }, 15000);

  it("prints that command's flags and exits 0 for `docuvia <command> --help`, without running the command", async () => {
    const result = await sandbox.runCli(["status", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("docuvia status");
    expect(result.stdout).not.toContain("Docuvia Status");
  }, 15000);

  it("still exits 1 with usage for a genuinely unknown command", async () => {
    const result = await sandbox.runCli(["not-a-real-command"], {
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  }, 15000);
});

describe("docuvia --interactive / -i (IFCE-004 opt-in)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({ initGit: true });
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("fails fast (does not hang) instead of launching the wizard when -i has no usable TTY behind it", async () => {
    const result = await sandbox.runCli(["-i"], { reject: false });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--interactive requires a real terminal");
  }, 15000);

  it("warns and still completes non-interactively when a command's -i has no usable TTY behind it (regression: must not hang)", async () => {
    const result = await sandbox.runCli(["clean", "-i"], { reject: false });

    expect(result.stderr).toContain("--interactive was requested");
    expect(result.stderr).toContain("continuing non-interactively");
  }, 15000);

  it("never prompts and completes normally without -i, even though this suite's execa child has no TTY either", async () => {
    const result = await sandbox.runCli(["status"]);

    expect(result.exitCode).toBe(0);
  }, 15000);
});
