import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createMockLogger,
  DEFAULT_HOOKS_CONFIG,
  HookNames,
} from "@workspace/contracts";
import { readHooksConfig, writeHookEnabled } from "./hooks-config-store.js";

describe("hooks-config-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-hooks-config-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readHooksConfig()", () => {
    it("returns DEFAULT_HOOKS_CONFIG when no file exists", async () => {
      const logger = createMockLogger();
      const config = await readHooksConfig(tmpDir, logger);

      expect(config).toEqual(DEFAULT_HOOKS_CONFIG);
      expect(logger.events).toEqual([]);
    });

    it("returns the file's content as-is when it's a valid, complete config", async () => {
      const dir = path.join(tmpDir, ".docuvia");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "hooks-config.json"),
        JSON.stringify({
          [HookNames.CONTEXT_INJECTION]: false,
          [HookNames.COMMIT_L3_WRITE]: true,
          [HookNames.TIER_B_C_PREPUSH]: false,
        }),
      );

      const config = await readHooksConfig(tmpDir, createMockLogger());

      expect(config).toEqual({
        [HookNames.CONTEXT_INJECTION]: false,
        [HookNames.COMMIT_L3_WRITE]: true,
        [HookNames.TIER_B_C_PREPUSH]: false,
      });
    });

    it("warns and falls back to defaults on corrupt JSON", async () => {
      const dir = path.join(tmpDir, ".docuvia");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "hooks-config.json"), "{ not json");

      const logger = createMockLogger();
      const config = await readHooksConfig(tmpDir, logger);

      expect(config).toEqual(DEFAULT_HOOKS_CONFIG);
      expect(logger.events.some((e) => e.level === "warn")).toBe(true);
    });

    it("warns and falls back to defaults when the top-level JSON value isn't an object", async () => {
      const dir = path.join(tmpDir, ".docuvia");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "hooks-config.json"), "[1,2,3]");

      const logger = createMockLogger();
      const config = await readHooksConfig(tmpDir, logger);

      expect(config).toEqual(DEFAULT_HOOKS_CONFIG);
      expect(logger.events.some((e) => e.level === "warn")).toBe(true);
    });

    it("fills a missing key from defaults when the file only has some of the three hooks", async () => {
      const dir = path.join(tmpDir, ".docuvia");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "hooks-config.json"),
        JSON.stringify({ [HookNames.COMMIT_L3_WRITE]: false }),
      );

      const config = await readHooksConfig(tmpDir, createMockLogger());

      expect(config).toEqual({
        [HookNames.CONTEXT_INJECTION]: true,
        [HookNames.COMMIT_L3_WRITE]: false,
        [HookNames.TIER_B_C_PREPUSH]: true,
      });
    });
  });

  describe("writeHookEnabled()", () => {
    it("creates .docuvia/ and the file when neither exists yet", async () => {
      await writeHookEnabled(
        tmpDir,
        HookNames.COMMIT_L3_WRITE,
        false,
        createMockLogger(),
      );

      const filePath = path.join(tmpDir, ".docuvia", "hooks-config.json");
      expect(fs.existsSync(filePath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(written).toEqual({
        [HookNames.CONTEXT_INJECTION]: true,
        [HookNames.COMMIT_L3_WRITE]: false,
        [HookNames.TIER_B_C_PREPUSH]: true,
      });
    });

    it("read-modify-writes without clobbering an existing, differently-set config", async () => {
      const dir = path.join(tmpDir, ".docuvia");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "hooks-config.json"),
        JSON.stringify({
          [HookNames.CONTEXT_INJECTION]: false,
          [HookNames.COMMIT_L3_WRITE]: true,
          [HookNames.TIER_B_C_PREPUSH]: true,
        }),
      );

      await writeHookEnabled(
        tmpDir,
        HookNames.TIER_B_C_PREPUSH,
        false,
        createMockLogger(),
      );

      const config = await readHooksConfig(tmpDir, createMockLogger());
      expect(config).toEqual({
        [HookNames.CONTEXT_INJECTION]: false,
        [HookNames.COMMIT_L3_WRITE]: true,
        [HookNames.TIER_B_C_PREPUSH]: false,
      });
    });

    it("self-heals a corrupt existing file to defaults-plus-this-change", async () => {
      const dir = path.join(tmpDir, ".docuvia");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "hooks-config.json"), "not json at all");

      await writeHookEnabled(
        tmpDir,
        HookNames.CONTEXT_INJECTION,
        false,
        createMockLogger(),
      );

      const config = await readHooksConfig(tmpDir, createMockLogger());
      expect(config).toEqual({
        [HookNames.CONTEXT_INJECTION]: false,
        [HookNames.COMMIT_L3_WRITE]: true,
        [HookNames.TIER_B_C_PREPUSH]: true,
      });
    });
  });
});
