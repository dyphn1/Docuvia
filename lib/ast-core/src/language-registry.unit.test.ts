import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { LanguageRegistry } from "./language-registry.js";
import { UTF8_ENCODING } from "@workspace/contracts";

const VALID_CUSTOM_LANGUAGE_TOML = `
[languages.custom]
extensions = [".custom"]
wasm_file = "tree-sitter-custom.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
`;

describe("LanguageRegistry.load() graceful fallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-language-registry-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("loads a valid languages.toml inside the project root", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "languages.toml"),
      VALID_CUSTOM_LANGUAGE_TOML,
      UTF8_ENCODING,
    );

    const registry = await LanguageRegistry.load(tmpDir);

    expect(registry.getProviderForExtension(".custom")).toBeDefined();
  });

  it("gracefully falls back to defaults when languages.toml is missing", async () => {
    const registry = await LanguageRegistry.load(tmpDir);
    expect(registry).toBeDefined();
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("gracefully falls back to defaults when languages.toml is invalid", async () => {
    const invalidTomlPath = path.join(tmpDir, "languages.toml");
    fs.writeFileSync(invalidTomlPath, "invalid = toml [ [ [", UTF8_ENCODING);

    const registry = await LanguageRegistry.load(tmpDir);
    expect(registry).toBeDefined();
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("rejects a languages.toml symlink that escapes the project root", async () => {
    if (process.platform === "win32") return;

    const outsidePath = path.join(
      path.dirname(tmpDir),
      `${path.basename(tmpDir)}-outside.toml`,
    );
    try {
      fs.writeFileSync(outsidePath, VALID_CUSTOM_LANGUAGE_TOML, UTF8_ENCODING);
      fs.symlinkSync(outsidePath, path.join(tmpDir, "languages.toml"));

      const registry = await LanguageRegistry.load(tmpDir);

      expect(registry.getProviderForExtension(".custom")).toBeUndefined();
      expect(registry.getConfig()).toEqual({ languages: {} });
    } finally {
      fs.rmSync(outsidePath, { force: true });
    }
  });

  it("rejects an oversized languages.toml before parsing", async () => {
    const oversizedToml = `${"# padding\n".repeat(30_000)}${VALID_CUSTOM_LANGUAGE_TOML}`;
    fs.writeFileSync(
      path.join(tmpDir, "languages.toml"),
      oversizedToml,
      UTF8_ENCODING,
    );

    const registry = await LanguageRegistry.load(tmpDir);

    expect(Buffer.byteLength(oversizedToml, UTF8_ENCODING)).toBeGreaterThan(
      256 * 1024,
    );
    expect(registry.getProviderForExtension(".custom")).toBeUndefined();
    expect(registry.getConfig()).toEqual({ languages: {} });
  });
});

describe("LanguageRegistry.loadFromString() schema validation (issue #168)", () => {
  it("accepts a valid TOML with correct structure", () => {
    const toml = `
[languages.typescript]
extensions = [".ts", ".tsx"]
wasm_file = "tree-sitter-typescript.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
`;
    const registry = LanguageRegistry.loadFromString(toml);
    const provider = registry.getProviderForExtension(".ts");
    expect(provider).toBeDefined();
  });

  it("rejects TOML where a language entry has missing required fields", () => {
    const toml = `
[languages.bash]
extensions = [".sh"]
wasm_file = "tree-sitter-bash.wasm"
`;
    const registry = LanguageRegistry.loadFromString(toml);
    // Missing imports/classes/functions/calls — should fall back to defaults
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("rejects TOML where wasm_file is not a string", () => {
    const toml = `
[languages.python]
extensions = [".py"]
wasm_file = 12345
imports = ["import_statement"]
classes = ["class_definition"]
functions = ["function_definition"]
calls = ["call"]
`;
    const registry = LanguageRegistry.loadFromString(toml);
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("rejects TOML where extensions is not an array of strings", () => {
    const toml = `
[languages.go]
extensions = "not-an-array"
wasm_file = "tree-sitter-go.wasm"
imports = ["import_declaration"]
classes = ["type_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
`;
    const registry = LanguageRegistry.loadFromString(toml);
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("rejects TOML where extensions contains non-string elements", () => {
    const toml = `
[languages.rust]
extensions = [".rs", 42]
wasm_file = "tree-sitter-rust.wasm"
imports = ["use_declaration"]
classes = ["impl_item"]
functions = ["function_item"]
calls = ["call_expression"]
`;
    const registry = LanguageRegistry.loadFromString(toml);
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("rejects TOML where 'languages' key is missing", () => {
    const toml = `
[toml]
version = "1.0"
`;
    const registry = LanguageRegistry.loadFromString(toml);
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("rejects TOML where languages is a string instead of object", () => {
    const toml = `
languages = "not-an-object"
`;
    const registry = LanguageRegistry.loadFromString(toml);
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("accepts optional implements/extends arrays when present", () => {
    const toml = `
[languages.typescript]
extensions = [".ts"]
wasm_file = "tree-sitter-typescript.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
implements = ["class_heritage"]
extends = ["class_heritage"]
`;
    const registry = LanguageRegistry.loadFromString(toml);
    const provider = registry.getProviderForExtension(".ts");
    expect(provider).toBeDefined();
  });

  it("rejects TOML where implements is not an array of strings", () => {
    const toml = `
[languages.typescript]
extensions = [".ts"]
wasm_file = "tree-sitter-typescript.wasm"
imports = ["import_statement"]
classes = ["class_declaration"]
functions = ["function_declaration"]
calls = ["call_expression"]
implements = [123]
`;
    const registry = LanguageRegistry.loadFromString(toml);
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("returns empty defaults for empty input", () => {
    const registry = LanguageRegistry.loadFromString(undefined);
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("returns empty defaults for empty string input", () => {
    const registry = LanguageRegistry.loadFromString("");
    expect(registry.getConfig()).toEqual({ languages: {} });
  });
});
