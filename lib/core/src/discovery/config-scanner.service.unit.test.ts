import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CONFIG_DETECTION_RULES,
  ConfigScannerService,
  type ConfigDetectionRule,
} from "./config-scanner.service.js";

function ruleById(id: string): ConfigDetectionRule {
  const rule = CONFIG_DETECTION_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`no such rule: ${id}`);
  return rule;
}

describe("CONFIG_DETECTION_RULES (per-rule unit tests, no filesystem I/O)", () => {
  describe("package.json rules", () => {
    it('typescript: matches package.json and the "typescript" marker', () => {
      const rule = ruleById("package.json:typescript");
      expect(rule.matchesFile("package.json")).toBe(true);
      expect(rule.matchesFile("tsconfig.json")).toBe(false);
      expect(rule.detect('{"devDependencies":{"typescript":"5.0.0"}}')).toEqual(
        {
          tags: ["typescript"],
        },
      );
      expect(rule.detect("{}")).toBeNull();
    });

    it("react: tags react + frontend", () => {
      const rule = ruleById("package.json:react");
      expect(rule.detect('{"dependencies":{"react":"18.0.0"}}')).toEqual({
        tags: ["react", "frontend"],
      });
      expect(rule.detect("{}")).toBeNull();
    });

    it("vue: tags vue + frontend", () => {
      const rule = ruleById("package.json:vue");
      expect(rule.detect('{"dependencies":{"vue":"3.0.0"}}')).toEqual({
        tags: ["vue", "frontend"],
      });
    });

    it("next: tags nextjs + frontend + ssr", () => {
      const rule = ruleById("package.json:next");
      expect(rule.detect('{"dependencies":{"next":"14.0.0"}}')).toEqual({
        tags: ["nextjs", "frontend", "ssr"],
      });
    });

    it("express: tags express + backend", () => {
      const rule = ruleById("package.json:express");
      expect(rule.detect('{"dependencies":{"express":"4.0.0"}}')).toEqual({
        tags: ["express", "backend"],
      });
    });

    it("drizzle-orm: tags drizzle + database", () => {
      const rule = ruleById("package.json:drizzle-orm");
      expect(rule.detect('{"dependencies":{"drizzle-orm":"0.36.0"}}')).toEqual({
        tags: ["drizzle", "database"],
      });
    });

    it("tailwindcss: tags tailwindcss + css", () => {
      const rule = ruleById("package.json:tailwindcss");
      expect(
        rule.detect('{"devDependencies":{"tailwindcss":"3.0.0"}}'),
      ).toEqual({
        tags: ["tailwindcss", "css"],
      });
    });

    it("jest: tags jest + testing", () => {
      const rule = ruleById("package.json:jest");
      expect(rule.detect('{"devDependencies":{"jest":"29.0.0"}}')).toEqual({
        tags: ["jest", "testing"],
      });
    });

    it("vitest: tags vitest + testing", () => {
      const rule = ruleById("package.json:vitest");
      expect(rule.detect('{"devDependencies":{"vitest":"1.0.0"}}')).toEqual({
        tags: ["vitest", "testing"],
      });
    });

    it("pg: tags postgres + database", () => {
      const rule = ruleById("package.json:pg");
      expect(rule.detect('{"dependencies":{"pg":"8.0.0"}}')).toEqual({
        tags: ["postgres", "database"],
      });
    });

    it("workspaces: tags monorepo", () => {
      const rule = ruleById("package.json:workspaces");
      expect(rule.detect('{"workspaces":["packages/*"]}')).toEqual({
        tags: ["monorepo"],
      });
    });
  });

  describe("Cargo.toml rules", () => {
    it("base rule always contributes rust regardless of content (presence-only, matches old Docuvia)", () => {
      const rule = ruleById("cargo:base");
      expect(rule.matchesFile("Cargo.toml")).toBe(true);
      expect(rule.matchesFile("cargo.toml")).toBe(false);
      expect(rule.detect("")).toEqual({ projectType: "rust", tags: ["rust"] });
      expect(rule.detect('[package]\nname = "x"')).toEqual({
        projectType: "rust",
        tags: ["rust"],
      });
    });

    it("tokio/actix/serde/tauri are independently content-gated", () => {
      expect(ruleById("cargo:tokio").detect('tokio = "1"')).toEqual({
        tags: ["tokio", "async"],
      });
      expect(ruleById("cargo:tokio").detect("")).toBeNull();

      expect(ruleById("cargo:actix").detect('actix-web = "4"')).toEqual({
        tags: ["actix", "backend"],
      });
      expect(ruleById("cargo:serde").detect('serde = "1"')).toEqual({
        tags: ["serde"],
      });
      expect(ruleById("cargo:tauri").detect('tauri = "1"')).toEqual({
        tags: ["tauri", "desktop"],
      });
    });
  });

  describe("python marker rules (pyproject.toml | requirements.txt)", () => {
    it("base rule matches both marker files and always contributes python", () => {
      const rule = ruleById("python:base");
      expect(rule.matchesFile("pyproject.toml")).toBe(true);
      expect(rule.matchesFile("requirements.txt")).toBe(true);
      expect(rule.matchesFile("setup.py")).toBe(false);
      expect(rule.detect("")).toEqual({
        projectType: "python",
        tags: ["python"],
      });
    });

    it("django/fastapi/pandas are independently content-gated", () => {
      expect(ruleById("python:django").detect("django==4.0")).toEqual({
        tags: ["django", "backend"],
      });
      expect(ruleById("python:django").detect("")).toBeNull();
      expect(ruleById("python:fastapi").detect("fastapi==0.100")).toEqual({
        tags: ["fastapi", "backend"],
      });
      expect(ruleById("python:pandas").detect("pandas==2.0")).toEqual({
        tags: ["pandas", "data"],
      });
    });
  });

  describe("go.mod rules", () => {
    it("base rule always contributes go", () => {
      const rule = ruleById("go:base");
      expect(rule.matchesFile("go.mod")).toBe(true);
      expect(rule.detect("module example.com/x")).toEqual({
        projectType: "go",
        tags: ["go"],
      });
    });

    it("gin-gonic is content-gated", () => {
      expect(
        ruleById("go:gin").detect("github.com/gin-gonic/gin v1.9.0"),
      ).toEqual({
        tags: ["gin", "backend"],
      });
      expect(ruleById("go:gin").detect("")).toBeNull();
    });
  });

  describe("tsconfig.json strict-mode rule", () => {
    it('matches only when "strict": true is present', () => {
      const rule = ruleById("tsconfig:strict");
      expect(rule.matchesFile("tsconfig.json")).toBe(true);
      expect(rule.detect('{"compilerOptions":{"strict":true}}')).toEqual({
        tags: ["strict-ts"],
      });
      expect(rule.detect('{"compilerOptions":{"strict":false}}')).toBeNull();
      expect(rule.detect("{}")).toBeNull();
    });
  });

  describe("presence-only config files (vite.config.*, drizzle.config.*, tauri.conf.*)", () => {
    it("match by basename prefix and contribute tags regardless of content, matching old Docuvia's behavior", () => {
      expect(ruleById("vite:presence").matchesFile("vite.config.ts")).toBe(
        true,
      );
      expect(ruleById("vite:presence").matchesFile("vite.config.mjs")).toBe(
        true,
      );
      expect(ruleById("vite:presence").matchesFile("vite.config.js")).toBe(
        true,
      );
      expect(ruleById("vite:presence").matchesFile("other.ts")).toBe(false);
      expect(ruleById("vite:presence").detect("")).toEqual({
        tags: ["vite", "build-tool"],
      });

      expect(
        ruleById("drizzle:presence").matchesFile("drizzle.config.ts"),
      ).toBe(true);
      expect(ruleById("drizzle:presence").detect("anything")).toEqual({
        tags: ["drizzle", "database"],
      });

      expect(ruleById("tauri:presence").matchesFile("tauri.conf.json")).toBe(
        true,
      );
      expect(ruleById("tauri:presence").detect("anything")).toEqual({
        tags: ["tauri", "desktop"],
      });
    });
  });
});

describe("ConfigScannerService.scanConfigs() (integration, real filesystem)", () => {
  let tmpDir: string;
  let service: ConfigScannerService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-config-scanner-test-"),
    );
    service = new ConfigScannerService();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns generic/general on a workspace with no recognized config files", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# hello\n");
    const result = await service.scanConfigs(tmpDir);
    expect(result).toEqual({ projectType: "generic", tags: ["general"] });
  });

  it("fuses multiple signals from a single package.json into projectType javascript + all matched tags", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { react: "18.0.0", express: "4.0.0" },
        devDependencies: { typescript: "5.0.0", vitest: "1.0.0" },
      }),
    );
    const result = await service.scanConfigs(tmpDir);
    expect(result.projectType).toBe("javascript");
    expect(result.tags.sort()).toEqual(
      [
        "backend",
        "express",
        "frontend",
        "react",
        "testing",
        "typescript",
        "vitest",
      ].sort(),
    );
  });

  it("Cargo.toml sets projectType rust even when other content-based tags are also present", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "Cargo.toml"),
      '[dependencies]\ntokio = "1"\nserde = "1"\n',
    );
    const result = await service.scanConfigs(tmpDir);
    expect(result.projectType).toBe("rust");
    expect(result.tags.sort()).toEqual(
      ["async", "rust", "serde", "tokio"].sort(),
    );
  });

  it("go.mod sets projectType go and detects gin-gonic", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "go.mod"),
      "module example.com/svc\n\nrequire github.com/gin-gonic/gin v1.9.0\n",
    );
    const result = await service.scanConfigs(tmpDir);
    expect(result.projectType).toBe("go");
    expect(result.tags.sort()).toEqual(["backend", "gin", "go"].sort());
  });

  it("presence-only files (vite.config.ts) contribute tags without any content match", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    fs.writeFileSync(
      path.join(tmpDir, "vite.config.ts"),
      "export default {}\n",
    );
    const result = await service.scanConfigs(tmpDir);
    expect(result.tags).toContain("vite");
    expect(result.tags).toContain("build-tool");
  });

  it("ignores node_modules and other excluded directories", async () => {
    fs.mkdirSync(path.join(tmpDir, "node_modules", "some-pkg"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, "node_modules", "some-pkg", "package.json"),
      JSON.stringify({ dependencies: { react: "18.0.0" } }),
    );
    const result = await service.scanConfigs(tmpDir);
    expect(result).toEqual({ projectType: "generic", tags: ["general"] });
  });
});
