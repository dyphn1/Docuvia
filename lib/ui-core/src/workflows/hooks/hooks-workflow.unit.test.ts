import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createMockLogger,
  DEFAULT_HOOKS_CONFIG,
  HookNames,
} from "@workspace/contracts";
import { listHooks, setHookEnabled } from "./hooks-workflow.js";

describe("hooks-workflow (thin pass-through)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-hooks-workflow-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("listHooks() returns DEFAULT_HOOKS_CONFIG on a fresh workspace", async () => {
    const config = await listHooks(tmpDir, createMockLogger());
    expect(config).toEqual(DEFAULT_HOOKS_CONFIG);
  });

  it("setHookEnabled() writes the toggle and returns the full, re-read config", async () => {
    const result = await setHookEnabled(
      tmpDir,
      HookNames.TIER_B_C_PREPUSH,
      false,
      createMockLogger(),
    );

    expect(result).toEqual({
      [HookNames.CONTEXT_INJECTION]: true,
      [HookNames.COMMIT_L3_WRITE]: true,
      [HookNames.TIER_B_C_PREPUSH]: false,
    });

    // Confirms it's a genuine re-read, not just an echoed-back input.
    const relisted = await listHooks(tmpDir, createMockLogger());
    expect(relisted).toEqual(result);
  });
});
