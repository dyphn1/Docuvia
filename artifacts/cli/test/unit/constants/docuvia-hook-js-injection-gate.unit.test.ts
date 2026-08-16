import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import process from "process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { DOCUVIA_HOOK_JS } from "../../../src/constants/init-templates.js";

/** Repo root resolved from this file (`artifacts/cli/test/unit/constants/`), not `process.cwd()`,
 *  so the sync assertion also holds when the package runs its own `test:unit` script with cwd set
 *  to `artifacts/cli`. */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", // unit
  "..", // test
  "..", // cli
  "..", // artifacts
  "..", // repo root
);

/**
 * `DOCUVIA_HOOK_JS`'s shell-injection guard (issue #51). The old template built its
 * `npx --no-install docuvia query "${target}" --format=prompt` command via direct string
 * interpolation of `target` into `execSync` -- a real shell-injection exposure: a crafted
 * `query`/`pattern` (Grep/Glob/Bash/Read tool-call input an agent, or transitively a prompt, can
 * influence) can break out of the quoted argument and execute arbitrary shell commands. Like the
 * other `DOCUVIA_HOOK_JS` gate (`docuvia-hook-js-gate.unit.test.ts` on the `feat/30` branch), this
 * runs the *actual* generated script text as a real child process against a crafted payload -- the
 * only way to exercise the script as shipped, since it's a string template embedded in a `.ts`
 * file, not an importable function. The behavioral assertions (no marker file) prove the fix at
 * runtime; the static assertions guard the exact vulnerable pattern so it can't be reintroduced.
 */
describe("DOCUVIA_HOOK_JS's shell-injection guard (issue #51)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-hook-injection-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Writes the real template text to a temp script and runs it with the given hook stdin. The
   *  hook swallows the (always-failing, since `npx` rarely resolves in the test env) `docuvia
   *  query` call into a stderr line and exits 0, so a successful execFileSync just means the
   *  script ran; what matters is whether an injected side-effect file appeared. */
  function runHookWithInput(input: object): void {
    const scriptPath = path.join(tmpDir, "docuvia-hook.js");
    fs.writeFileSync(scriptPath, DOCUVIA_HOOK_JS);
    execFileSync(process.execPath, [scriptPath], {
      cwd: tmpDir,
      input: JSON.stringify(input),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  it("does not execute shell commands injected via a crafted query target", () => {
    const marker = path.join(tmpDir, "pwned");
    const payload = `foo" ; touch ${marker} ; "`;
    runHookWithInput({ args: { query: payload } });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("does not execute shell commands injected via a crafted grep pattern", () => {
    const marker = path.join(tmpDir, "pwned-pattern");
    const payload = `foo" && touch ${marker} && "`;
    runHookWithInput({ args: { pattern: payload } });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("builds the command via execFileSync with an argument array, never execSync string interpolation", () => {
    expect(DOCUVIA_HOOK_JS).not.toMatch(
      /npx --no-install docuvia query "\$\{target\}"/,
    );
    expect(DOCUVIA_HOOK_JS).toContain("execFileSync");
  });

  it("stays in sync with the committed live .claude/hooks/docuvia-hook.js", () => {
    const live = fs.readFileSync(
      path.join(REPO_ROOT, ".claude", "hooks", "docuvia-hook.js"),
      "utf-8",
    );
    expect(live).toBe(DOCUVIA_HOOK_JS);
  });
});
