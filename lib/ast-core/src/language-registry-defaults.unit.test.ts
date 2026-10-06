import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Language } from "web-tree-sitter";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadDefaultRegistry,
  loadDefaultRegistryFromString,
} from "./language-registry-defaults.js";
import { DefaultProvider, type LanguageConfig } from "./language-provider.js";

function configFor(provider: unknown): LanguageConfig {
  return (provider as { config: LanguageConfig }).config;
}

const CUSTOM_TYPESCRIPT_TOML = `
[languages.typescript]
extensions = [".ts", ".tsx"]
wasm_file = "tree-sitter-typescript.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]

[languages.typescript.queries]
classes = "(class_declaration) @class"
`;

const CUSTOM_TYPESCRIPT_WASM_TOML = `
[languages.typescript]
extensions = [".ts", ".tsx"]
wasm_file = "custom-typescript.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
`;

const CUSTOM_SHARED_LANGUAGE_TOML = `
[languages.custom]
extensions = [".ts", ".tsx"]
wasm_file = "custom-shared.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
`;

const CUSTOM_TYPESCRIPT_ONLY_TOML = `
[languages.custom_typescript]
extensions = [".ts"]
wasm_file = "custom-typescript-only.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
`;

const CUSTOM_TSX_TOML = `
[languages.custom_tsx]
extensions = [".tsx"]
wasm_file = "custom-tsx.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
`;

describe("default TypeScript and TSX provider routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[happy] creates separate providers without loading a grammar", () => {
    const languageLoad = vi.spyOn(Language, "load");

    const registry = loadDefaultRegistryFromString();
    const typescript = registry.getProviderForExtension(".ts");
    const tsx = registry.getProviderForExtension(".tsx");

    expect(typescript).toBeInstanceOf(DefaultProvider);
    expect(tsx).toBeInstanceOf(DefaultProvider);
    expect(tsx).not.toBe(typescript);
    expect(typescript?.wasm_file).toBe("tree-sitter-typescript.wasm");
    expect(tsx?.wasm_file).toBe("tree-sitter-tsx.wasm");
    expect(languageLoad).not.toHaveBeenCalled();
  });

  it("[happy] copies effective TypeScript queries into the TSX provider", () => {
    const registry = loadDefaultRegistryFromString(CUSTOM_TYPESCRIPT_TOML);
    const typescript = registry.getProviderForExtension(".ts");
    const tsx = registry.getProviderForExtension(".tsx");

    expect(tsx).not.toBe(typescript);
    expect(typescript?.wasm_file).toBe("tree-sitter-typescript.wasm");
    expect(tsx?.wasm_file).toBe("tree-sitter-tsx.wasm");
    expect(configFor(tsx).queries?.classes).toBe("(class_declaration) @class");
    expect(configFor(tsx).imports).toEqual(["import_statement"]);
  });

  it("[happy] preserves an explicit TypeScript grammar override for both extensions", () => {
    const registry = loadDefaultRegistryFromString(CUSTOM_TYPESCRIPT_WASM_TOML);
    const typescript = registry.getProviderForExtension(".ts");
    const tsx = registry.getProviderForExtension(".tsx");

    expect(tsx).toBe(typescript);
    expect(typescript?.wasm_file).toBe("custom-typescript.wasm");
  });

  it("[happy] preserves a later shared custom language owner for both extensions", () => {
    const registry = loadDefaultRegistryFromString(CUSTOM_SHARED_LANGUAGE_TOML);
    const typescript = registry.getProviderForExtension(".ts");
    const tsx = registry.getProviderForExtension(".tsx");

    expect(tsx).toBe(typescript);
    expect(typescript?.wasm_file).toBe("custom-shared.wasm");
  });

  it("[happy] gives the default TSX extension its grammar when only TS is overridden", () => {
    const registry = loadDefaultRegistryFromString(CUSTOM_TYPESCRIPT_ONLY_TOML);
    const typescript = registry.getProviderForExtension(".ts");
    const tsx = registry.getProviderForExtension(".tsx");

    expect(typescript?.wasm_file).toBe("custom-typescript-only.wasm");
    expect(tsx).not.toBe(typescript);
    expect(tsx?.wasm_file).toBe("tree-sitter-tsx.wasm");
  });

  it("[happy] preserves a later explicit project TSX override", async () => {
    const projectRoot = mkdtempSync(
      path.join(os.tmpdir(), "docuvia-language-registry-tsx-"),
    );
    try {
      writeFileSync(
        path.join(projectRoot, "languages.toml"),
        CUSTOM_TSX_TOML,
        "utf8",
      );

      const registry = await loadDefaultRegistry(projectRoot);
      const typescript = registry.getProviderForExtension(".ts");
      const tsx = registry.getProviderForExtension(".tsx");

      expect(typescript).not.toBe(tsx);
      expect(typescript?.wasm_file).toBe("tree-sitter-typescript.wasm");
      expect(tsx?.wasm_file).toBe("custom-tsx.wasm");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("[invalid-input] falls back to split defaults for malformed TOML", () => {
    const registry = loadDefaultRegistryFromString("[languages.typescript");

    expect(registry.getProviderForExtension(".ts")?.wasm_file).toBe(
      "tree-sitter-typescript.wasm",
    );
    expect(registry.getProviderForExtension(".tsx")?.wasm_file).toBe(
      "tree-sitter-tsx.wasm",
    );
  });

  it("[error-handling] falls back when project languages.toml is not a file", async () => {
    const projectRoot = mkdtempSync(
      path.join(os.tmpdir(), "docuvia-language-registry-tsx-error-"),
    );
    try {
      mkdirSync(path.join(projectRoot, "languages.toml"));

      const registry = await loadDefaultRegistry(projectRoot);

      expect(registry.getProviderForExtension(".ts")?.wasm_file).toBe(
        "tree-sitter-typescript.wasm",
      );
      expect(registry.getProviderForExtension(".tsx")?.wasm_file).toBe(
        "tree-sitter-tsx.wasm",
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
