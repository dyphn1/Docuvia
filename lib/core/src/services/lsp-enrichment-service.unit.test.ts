import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { LspEnrichmentService } from "./lsp-enrichment-service.js";

describe("LspEnrichmentService", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-lsp-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("degrades gracefully (returns []) instead of throwing when no tsconfig.json exists", () => {
    const service = new LspEnrichmentService(tmpDir);
    const filePath = path.join(tmpDir, "a.ts");
    fs.writeFileSync(filePath, "export function foo() {}\n");

    expect(() => service.enrichImpact("foo", filePath)).not.toThrow();
    expect(service.enrichImpact("foo", filePath)).toEqual([]);
  });

  it("reuses a cached LanguageService across instances for the same workspace root", () => {
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    const filePath = path.join(tmpDir, "a.ts");
    fs.writeFileSync(filePath, "export function foo() { return 1; }\nfoo();\n");

    const spy = vi.spyOn(ts, "createLanguageService");

    new LspEnrichmentService(tmpDir).enrichImpact("foo", filePath);
    new LspEnrichmentService(tmpDir).enrichImpact("foo", filePath);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
