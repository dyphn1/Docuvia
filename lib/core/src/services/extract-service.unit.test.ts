import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ExtractService, MAX_ANALYZE_FILES, MAX_ANALYZE_BYTES } from "./extract-service.js";
import { DEFAULT_PROMPTS } from "../utils/prompts.js";
import { logger } from "../utils/logger.js";

const ORIGINAL_ENV = { ...process.env };

const ENV_KEYS_TO_CLEAR = [
  "OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "DOCUVIA_LLM_PROVIDER",
  "OLLAMA_BASE_URL",
  // The api-server test suite's global setup (artifacts/api-server/test/setup/setup.ts)
  // force-sets this to an unroutable mock port as a network-call safety net, which would
  // otherwise leak into these tests when the whole workspace's test suite runs together.
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "GEMINI_BASE_URL",
];

function clearLlmEnv(): void {
  for (const key of ENV_KEYS_TO_CLEAR) delete process.env[key];
}

function okJsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function openaiCompletion(content: string) {
  return okJsonResponse({ choices: [{ message: { content } }] });
}

describe("ExtractService.extractDecisions", () => {
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-extract-service-test-"));
    process.env = { ...ORIGINAL_ENV };
    clearLlmEnv();
    process.env.OPENAI_API_KEY = "test-openai-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws when the target path does not exist", async () => {
    const service = new ExtractService(tmpDir);
    await expect(service.extractDecisions("does-not-exist.ts")).rejects.toThrow(
      /Path does not exist/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a single file, calls the LLM with the path_decision_extractor prompt, and parses the richer decision shape", async () => {
    fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export function foo() { return 1; }\n");

    const fakeDecisions = [
      {
        title: "Use explicit return",
        nodeType: "decision",
        content: "Returns 1 explicitly.",
        confidence: 0.8,
      },
    ];
    fetchMock.mockResolvedValueOnce(openaiCompletion(JSON.stringify(fakeDecisions)));

    const service = new ExtractService(tmpDir);
    const result = await service.extractDecisions("foo.ts");

    expect(result.decisions).toEqual(fakeDecisions);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer test-openai-key");

    const requestBody = JSON.parse(options.body);
    expect(requestBody.messages[0]).toEqual({
      role: "system",
      content: DEFAULT_PROMPTS.path_decision_extractor,
    });
    expect(requestBody.messages[1].role).toBe("user");
    expect(requestBody.messages[1].content).toContain("foo.ts");
    expect(requestBody.messages[1].content).toContain("export function foo()");
  });

  it("throws a clear error when the LLM returns non-JSON output", async () => {
    fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const x = 1;\n");
    fetchMock.mockResolvedValueOnce(openaiCompletion("this is not json"));

    const service = new ExtractService(tmpDir);
    await expect(service.extractDecisions("foo.ts")).rejects.toThrow(/non-JSON/);
  });

  it("throws a clear, actionable error (not fake decisions) when no LLM API key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const x = 1;\n");

    const service = new ExtractService(tmpDir);
    await expect(service.extractDecisions("foo.ts")).rejects.toThrow(/API key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only includes supported source files from a directory and returns an empty array honestly when none are decision-worthy", async () => {
    const dir = path.join(tmpDir, "proj");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(dir, "notes.unsupportedext"), "not source code, should be ignored");

    fetchMock.mockResolvedValueOnce(openaiCompletion(JSON.stringify([])));

    const service = new ExtractService(tmpDir);
    const result = await service.extractDecisions("proj");

    expect(result.decisions).toEqual([]);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.messages[1].content).toContain("a.ts");
    expect(requestBody.messages[1].content).not.toContain("notes.unsupportedext");
  });

  it("caps the number of files sent to the LLM at MAX_ANALYZE_FILES and logs the dropped files", async () => {
    const dir = path.join(tmpDir, "many");
    fs.mkdirSync(dir, { recursive: true });
    const fileCount = MAX_ANALYZE_FILES + 2;
    for (let i = 0; i < fileCount; i++) {
      const name = `file-${String(i).padStart(3, "0")}.ts`;
      fs.writeFileSync(path.join(dir, name), `export const v${i} = ${i};\n`);
    }

    const warnSpy = vi.spyOn(logger, "warn");
    fetchMock.mockResolvedValueOnce(openaiCompletion(JSON.stringify([])));

    const service = new ExtractService(tmpDir);
    await service.extractDecisions("many");

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const includedSeparators = requestBody.messages[1].content.match(/^--- /gm) ?? [];
    expect(includedSeparators.length).toBe(MAX_ANALYZE_FILES);

    expect(warnSpy).toHaveBeenCalled();
    const warnCall = warnSpy.mock.calls.find((call) => String(call[1] ?? "").includes("Dropped"));
    expect(warnCall).toBeTruthy();
    expect((warnCall![0] as any).droppedFiles.length).toBe(fileCount - MAX_ANALYZE_FILES);
  });

  it("caps cumulative content at MAX_ANALYZE_BYTES and logs the dropped files", async () => {
    const dir = path.join(tmpDir, "big");
    fs.mkdirSync(dir, { recursive: true });
    const bigContent = "a".repeat(Math.floor(MAX_ANALYZE_BYTES * 0.7));
    fs.writeFileSync(path.join(dir, "big-a.ts"), `// MARKER_A\n${bigContent}\n`);
    fs.writeFileSync(path.join(dir, "big-b.ts"), `// MARKER_B\n${bigContent}\n`);

    const warnSpy = vi.spyOn(logger, "warn");
    fetchMock.mockResolvedValueOnce(openaiCompletion(JSON.stringify([])));

    const service = new ExtractService(tmpDir);
    await service.extractDecisions("big");

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const content = requestBody.messages[1].content as string;
    const hasA = content.includes("MARKER_A");
    const hasB = content.includes("MARKER_B");
    // Only one of the two oversized files should fit under the cumulative byte cap.
    expect(hasA !== hasB).toBe(true);

    expect(warnSpy).toHaveBeenCalled();
    const warnCall = warnSpy.mock.calls.find((call) => String(call[1] ?? "").includes("Dropped"));
    expect(warnCall).toBeTruthy();
    expect((warnCall![0] as any).droppedFiles.length).toBe(1);
  });
});
