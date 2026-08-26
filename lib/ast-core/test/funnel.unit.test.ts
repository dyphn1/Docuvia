import { describe, it, expect } from "vitest";
import { ParsingFunnel } from "../src/funnel.js";
import { LanguageRegistry } from "../src/language-registry.js";
import { DefaultProvider } from "../src/language-provider.js";

describe("ParsingFunnel", () => {
  const registry = new LanguageRegistry();
  const tsProvider = new DefaultProvider({
    extensions: [".ts"],
    wasm_file: "",
  });
  const jsProvider = new DefaultProvider({
    extensions: [".js"],
    wasm_file: "",
  });
  const pyProvider = new DefaultProvider({
    extensions: [".py"],
    wasm_file: "",
  });

  registry.registerProvider([".ts"], tsProvider);
  registry.registerProvider([".js"], jsProvider);
  registry.registerProvider([".py"], pyProvider);

  const funnel = new ParsingFunnel(registry);

  it("accepts valid registered extensions", () => {
    const res = funnel.process("content", "test.ts", ".ts");
    expect(res.accepted).toBe(true);
    expect(res.mappedExtension).toBe(".ts");
    expect(res.reason).toBeUndefined();
  });

  it("rejects unknown extensions", () => {
    const res = funnel.process("content", "test.unknown", ".unknown");
    expect(res.accepted).toBe(false);
    expect(res.reason).toContain("not allowed");
    expect(res.mappedExtension).toBeUndefined();
  });

  it("rejects binary files", () => {
    const binary = new Uint8Array([0x68, 0x65, 0x00, 0x6c, 0x6f]); // Contains null byte
    const res = funnel.process(binary, "binary.bin", ".ts");
    expect(res.accepted).toBe(false);
    expect(res.reason).toContain("Binary file detected");
    expect(res.mappedExtension).toBeUndefined();
  });

  it("rejects invalid UTF-8 files", () => {
    const invalidUtf8 = new Uint8Array([0xff, 0xff, 0xff]); // Invalid UTF-8
    const res = funnel.process(invalidUtf8, "invalid.ts", ".ts");
    expect(res.accepted).toBe(false);
    expect(res.reason).toContain("Invalid UTF-8");
    expect(res.mappedExtension).toBeUndefined();
  });

  it("detects node shebang", () => {
    const res = funnel.process(
      "#!/usr/bin/env node\nconsole.log(1)",
      "cli",
      "",
    );
    expect(res.accepted).toBe(true);
    expect(res.mappedExtension).toBe(".js");
  });

  it("detects python shebang", () => {
    const res = funnel.process("#!/usr/bin/python\nprint(1)", "cli", "");
    expect(res.accepted).toBe(true);
    expect(res.mappedExtension).toBe(".py");
  });

  it("rejects file with no extension and no shebang", () => {
    const res = funnel.process("just text", "cli", "");
    expect(res.accepted).toBe(false);
    expect(res.reason).toContain("No file extension and no shebang detected");
    expect(res.mappedExtension).toBeUndefined();
  });

  it("rejects shell script shebang if not in registry", () => {
    const res = funnel.process("#!/bin/bash\necho 1", "cli", "");
    expect(res.accepted).toBe(false);
    expect(res.reason).toContain("Extension .sh not allowed");
    expect(res.mappedExtension).toBeUndefined();
  });
});
