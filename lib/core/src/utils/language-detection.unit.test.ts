import { describe, it, expect } from "vitest";
import { DEFAULT_REGISTRY } from "@workspace/plugins-ast";
import {
  detectLanguageForFile,
  isSupportedSourceFile,
  getSupportedGlobExtensions,
} from "./language-detection.js";

describe("language-detection", () => {
  it("detects the DEFAULT_REGISTRY language name for a known extension", () => {
    expect(detectLanguageForFile("foo.tsx")).toBe("typescript");
    expect(detectLanguageForFile("foo.ts")).toBe("typescript");
    expect(detectLanguageForFile("foo.py")).toBe("python");
    expect(detectLanguageForFile("foo.rs")).toBe("rust");
  });

  it("is case-insensitive on the file extension", () => {
    expect(detectLanguageForFile("FOO.TS")).toBe("typescript");
  });

  it("returns undefined for an unrecognized extension", () => {
    expect(detectLanguageForFile("foo.exe")).toBeUndefined();
  });

  it("isSupportedSourceFile mirrors detectLanguageForFile presence", () => {
    expect(isSupportedSourceFile("foo.ts")).toBe(true);
    expect(isSupportedSourceFile("foo.exe")).toBe(false);
  });

  it("detects .mjs/.cjs as javascript and .mts/.cts as typescript (same grammar, extra module-resolution extensions)", () => {
    expect(detectLanguageForFile("foo.mjs")).toBe("javascript");
    expect(detectLanguageForFile("foo.cjs")).toBe("javascript");
    expect(detectLanguageForFile("foo.mts")).toBe("typescript");
    expect(detectLanguageForFile("foo.cts")).toBe("typescript");
  });

  it("detects .cu/.cuh as cpp", () => {
    expect(detectLanguageForFile("kernel.cu")).toBe("cpp");
    expect(detectLanguageForFile("kernel.cuh")).toBe("cpp");
  });

  it("detects extensionless Ruby convention files by basename", () => {
    expect(detectLanguageForFile("Gemfile")).toBe("ruby");
    expect(detectLanguageForFile("Rakefile")).toBe("ruby");
    expect(detectLanguageForFile("Guardfile")).toBe("ruby");
    expect(detectLanguageForFile("Vagrantfile")).toBe("ruby");
    expect(detectLanguageForFile("Brewfile")).toBe("ruby");
    expect(detectLanguageForFile("path/to/Gemfile")).toBe("ruby");
    expect(isSupportedSourceFile("Gemfile")).toBe(true);
  });

  it("does not treat arbitrary extensionless files as Ruby", () => {
    expect(detectLanguageForFile("README")).toBeUndefined();
    expect(isSupportedSourceFile("README")).toBe(false);
  });

  it("getSupportedGlobExtensions returns a non-empty, dot-free extension list matching DEFAULT_REGISTRY", () => {
    const exts = getSupportedGlobExtensions();
    expect(exts.length).toBeGreaterThan(0);
    expect(exts.every((ext) => !ext.startsWith("."))).toBe(true);

    const allRegistryExtensions = new Set(
      Object.values(DEFAULT_REGISTRY.languages).flatMap(
        (config) => config.extensions,
      ),
    );
    for (const ext of exts) {
      expect(allRegistryExtensions.has(`.${ext}`)).toBe(true);
    }
  });
});
