import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  resetFactoryForTests,
  createMockLogger,
  type IConfigScanner,
  type ILlmClient,
} from "@workspace/contracts";
import { AnalyzeWorkflow, stripMarkdownCodeFence } from "./analyze-workflow.js";
import { DECISION_EXTRACTION_SYSTEM_PROMPT } from "./analyze-messages.js";
import { MAX_ANALYZE_FILES } from "./decision-extraction.js";

describe("AnalyzeWorkflow.execute()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-analyze-workflow-test-"),
    );
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves IConfigScanner from the factory and returns its scan result", async () => {
    const configScanner: IConfigScanner = {
      scanConfigs: vi.fn().mockResolvedValue({
        projectType: "typescript",
        tags: ["typescript", "react"],
      }),
    };
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(configScanner.scanConfigs).toHaveBeenCalledWith(tmpDir);
    expect(result).toEqual({
      kind: "configScan",
      projectType: "typescript",
      suggestedTags: ["typescript", "react"],
    });
  });

  it("logs an analyze.start and analyze.summary JSONL event to .docuvia/logs/analyze.log", async () => {
    const configScanner: IConfigScanner = {
      scanConfigs: vi
        .fn()
        .mockResolvedValue({ projectType: "generic", tags: ["general"] }),
    };
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.lock();

    await new AnalyzeWorkflow(tmpDir, createMockLogger()).execute();

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines.some((l) => l.event === "analyze.start")).toBe(true);
    const summary = lines.find((l) => l.event === "analyze.summary");
    expect(summary?.projectType).toBe("generic");
    expect(summary?.suggestedTags).toEqual(["general"]);
  });
});

describe("AnalyzeWorkflow.execute() — decision extraction (targetPath set)", () => {
  let tmpDir: string;
  const llmOptions = {
    llmBaseUrl: "http://localhost:9999",
    llmApiKey: "test-key",
    llmModel: "test-model",
  };

  function readAnalyzeLog(): Array<Record<string, unknown>> {
    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    return fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-analyze-workflow-extraction-test-"),
    );
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws DocuviaError and logs analyze.focused.error when the target path does not exist", async () => {
    docuviaFactory.lock();

    await expect(
      new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "does/not/exist.ts",
        ...llmOptions,
      }).execute(),
    ).rejects.toThrow("Path does not exist: does/not/exist.ts");

    const lines = readAnalyzeLog();
    const errorLine = lines.find((l) => l.event === "analyze.focused.error");
    expect(errorLine).toBeDefined();
    expect(errorLine?.message).toBe("Path does not exist: does/not/exist.ts");
  });

  it("returns an empty decisionExtraction result and never resolves TOKENS.LlmClient when no eligible files are found", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# no source files here");
    // README.md is not a supported source extension, so nothing is collected.

    const llmClientBuilderProvider = vi.fn(() => () => ({}) as ILlmClient);
    docuviaFactory.register(TOKENS.LlmClient, llmClientBuilderProvider);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "README.md",
      ...llmOptions,
    }).execute();

    expect(result).toEqual({
      kind: "decisionExtraction",
      targetPath: "README.md",
      decisions: [],
    });
    expect(llmClientBuilderProvider).not.toHaveBeenCalled();
  });

  it("happy path: resolves TOKENS.LlmClient, calls chatCompletion with the verbatim system prompt + collected file content, and maps the JSON response", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "sample.ts"),
      "export const x = 1; // a decision-worthy comment\n",
    );

    const mockLlmClient: ILlmClient = {
      initialize: vi.fn(),
      chatCompletion: vi.fn().mockResolvedValue({
        id: "chatcmpl-1",
        model: "test-model",
        choices: [
          {
            index: 0,
            finishReason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify([
                {
                  title: "Uses a const export",
                  nodeType: "decision",
                  content: "x is exported as a const.",
                  confidence: 0.9,
                },
              ]),
            },
          },
        ],
      }),
      streamChatCompletion: vi.fn(),
    };
    docuviaFactory.register(TOKENS.LlmClient, () => () => mockLlmClient);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "sample.ts",
      ...llmOptions,
    }).execute();

    expect(mockLlmClient.initialize).toHaveBeenCalledWith({
      baseUrl: llmOptions.llmBaseUrl,
      apiKey: llmOptions.llmApiKey,
    });

    expect(mockLlmClient.chatCompletion).toHaveBeenCalledTimes(1);
    const request = vi.mocked(mockLlmClient.chatCompletion).mock.calls[0][0];
    expect(request.model).toBe(llmOptions.llmModel);
    expect(request.temperature).toBe(0.2);
    expect(request.messages[0]).toEqual({
      role: "system",
      content: DECISION_EXTRACTION_SYSTEM_PROMPT,
    });
    expect(request.messages[1].role).toBe("user");
    expect(request.messages[1].content).toContain("--- sample.ts ---");
    expect(request.messages[1].content).toContain(
      "export const x = 1; // a decision-worthy comment",
    );

    expect(result).toEqual({
      kind: "decisionExtraction",
      targetPath: "sample.ts",
      decisions: [
        {
          title: "Uses a const export",
          nodeType: "decision",
          content: "x is exported as a const.",
          confidence: 0.9,
        },
      ],
    });

    const lines = readAnalyzeLog();
    expect(lines.some((l) => l.event === "analyze.focused.start")).toBe(true);
    const summary = lines.find((l) => l.event === "analyze.focused.summary");
    expect(summary?.decisionsCount).toBe(1);
  });

  it("strips a ```json ... ``` markdown fence before parsing (regression: live Mistral smoke test)", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    // Real shape observed from a live Mistral (CLIProxyAPI-compatible) backend: the model wraps
    // an otherwise well-formed JSON array response in a ```json fence even though the system
    // prompt asks it not to.
    registerLlmClientReturning(
      "```json\n" +
        JSON.stringify(
          [
            {
              title: "process.exitCode used instead of process.exit()",
              nodeType: "rule",
              content:
                "Both branches of analyzeCommand set process.exitCode = 1 rather than calling process.exit(1), avoiding a native crash while network handles are still closing.",
              confidence: 0.95,
            },
            {
              title: "LLM client resolved via TOKENS.LlmClient factory token",
              nodeType: "decision",
              content:
                "The decision-extraction path resolves TOKENS.LlmClient from docuviaFactory rather than importing a concrete client directly, matching the SyncWorkflow pattern for TOKENS.RemoteSyncClient.",
              confidence: 0.9,
            },
            {
              title: "Non-JSON LLM output is reported as LLM_INVALID_RESPONSE",
              nodeType: "context",
              content:
                "Any response body that fails JSON.parse or does not parse to an array is normalized into a single DocuviaError with code LLM_INVALID_RESPONSE.",
              confidence: 0.85,
            },
          ],
          null,
          2,
        ) +
        "\n```",
    );
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "sample.ts",
      ...llmOptions,
    }).execute();

    expect(result.kind).toBe("decisionExtraction");
    expect(
      (result as { decisions: Array<{ title: string }> }).decisions,
    ).toHaveLength(3);
    expect(
      (result as { decisions: Array<{ title: string }> }).decisions[0].title,
    ).toBe("process.exitCode used instead of process.exit()");
  });

  it("strips a bare ``` ... ``` markdown fence (no language tag) before parsing", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(
      "```\n" +
        JSON.stringify([
          {
            title: "Bare-fenced decision",
            nodeType: "decision",
            content: "Wrapped in a fence with no json language tag.",
            confidence: 0.7,
          },
        ]) +
        "\n```",
    );
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "sample.ts",
      ...llmOptions,
    }).execute();

    expect(result).toEqual({
      kind: "decisionExtraction",
      targetPath: "sample.ts",
      decisions: [
        {
          title: "Bare-fenced decision",
          nodeType: "decision",
          content: "Wrapped in a fence with no json language tag.",
          confidence: 0.7,
        },
      ],
    });
  });

  it("still throws LLM_INVALID_RESPONSE when fenced content isn't valid JSON (fence-stripping must not swallow real parse errors)", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(
      "```json\nthis is not json even after stripping\n```",
    );
    docuviaFactory.lock();

    let caught: unknown;
    try {
      await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocuviaError);
    expect((caught as DocuviaError).code).toBe("LLM_INVALID_RESPONSE");
  });

  function registerLlmClientReturning(content: string | null) {
    const mockLlmClient: ILlmClient = {
      initialize: vi.fn(),
      chatCompletion: vi.fn().mockResolvedValue({
        id: "chatcmpl-1",
        model: "test-model",
        choices: [
          {
            index: 0,
            finishReason: "stop",
            message: { role: "assistant", content },
          },
        ],
      }),
      streamChatCompletion: vi.fn(),
    };
    docuviaFactory.register(TOKENS.LlmClient, () => () => mockLlmClient);
  }

  it("throws DocuviaError with code LLM_INVALID_RESPONSE and logs analyze.focused.error on non-JSON response content", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning("this is not json");
    docuviaFactory.lock();

    let caught: unknown;
    try {
      await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocuviaError);
    expect((caught as DocuviaError).code).toBe("LLM_INVALID_RESPONSE");

    const lines = readAnalyzeLog();
    expect(lines.some((l) => l.event === "analyze.focused.error")).toBe(true);
  });

  it("throws DocuviaError with code LLM_INVALID_RESPONSE when the response content is null", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(null);
    docuviaFactory.lock();

    let caught: unknown;
    try {
      await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocuviaError);
    expect((caught as DocuviaError).code).toBe("LLM_INVALID_RESPONSE");
  });

  it("throws DocuviaError with code LLM_INVALID_RESPONSE when the parsed JSON is not an array", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(JSON.stringify({}));
    docuviaFactory.lock();

    let caught: unknown;
    try {
      await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocuviaError);
    expect((caught as DocuviaError).code).toBe("LLM_INVALID_RESPONSE");
  });

  it("defensively coerces missing/wrong-typed fields in the LLM response", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(
      JSON.stringify([
        { title: null, nodeType: "not-a-real-type", confidence: "high" },
      ]),
    );
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "sample.ts",
      ...llmOptions,
    }).execute();

    expect(result).toEqual({
      kind: "decisionExtraction",
      targetPath: "sample.ts",
      decisions: [
        { title: "", nodeType: "context", content: "", confidence: 0 },
      ],
    });
  });

  it("logs a logger.warn referencing dropped files when the file-count cap is exceeded", async () => {
    for (let i = 0; i < MAX_ANALYZE_FILES + 1; i++) {
      fs.writeFileSync(path.join(tmpDir, `file-${i}.ts`), `// file ${i}\n`);
    }
    registerLlmClientReturning(JSON.stringify([]));
    docuviaFactory.lock();

    const logger = createMockLogger();
    await new AnalyzeWorkflow(tmpDir, logger, {
      targetPath: ".",
      ...llmOptions,
    }).execute();

    const warnEvent = logger.events.find(
      (e) =>
        e.level === "warn" &&
        Array.isArray(
          (e.context as { droppedFiles?: string[] })?.droppedFiles,
        ) &&
        (e.context as { droppedFiles: string[] }).droppedFiles.length === 1,
    );
    expect(warnEvent).toBeDefined();
  });
});

describe("stripMarkdownCodeFence()", () => {
  it("strips a ```json ... ``` fence and trims surrounding whitespace", () => {
    const input = "  \n```json\n[1,2,3]\n```\n  ";
    expect(stripMarkdownCodeFence(input)).toBe("[1,2,3]");
  });

  it("strips a bare ``` ... ``` fence with no language tag", () => {
    const input = "```\n[1,2,3]\n```";
    expect(stripMarkdownCodeFence(input)).toBe("[1,2,3]");
  });

  it("returns unfenced content unchanged", () => {
    const input = "[1,2,3]";
    expect(stripMarkdownCodeFence(input)).toBe(input);
  });

  it("returns content unchanged when only the start looks fenced but the end does not", () => {
    const input = "```json\n[1,2,3]";
    expect(stripMarkdownCodeFence(input)).toBe(input);
  });

  it("leaves multi-line, still-invalid-JSON fenced content stripped-but-unparsed (caller's JSON.parse must still fail)", () => {
    const input = "```json\nnot json\n```";
    expect(stripMarkdownCodeFence(input)).toBe("not json");
  });
});
