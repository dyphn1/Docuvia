import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryCommand, formatPromptOutput } from "../../../src/commands/query.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, DI_KEYS, container } from "@workspace/core";

// We need to mock the services we are resolving from the container
const mockQuery = vi.fn();
container.register(DI_TOKENS.QueryService, { query: mockQuery });

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
    askInput: vi.fn(),
  },
}));

describe("queryCommand", () => {
  let exitSpy: any;
  let logSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully query and output format", async () => {
    mockQuery.mockResolvedValue({
      l2: { name: "Test L2" },
      l3: [{ title: "Test L3", status: "active", content: "Test Content" }],
    });

    await queryCommand("test-target", { format: "prompt" });
    expect(mockQuery).toHaveBeenCalledWith("test-target", { format: "prompt" });
    expect(logSpy).toHaveBeenCalled();
  });

  describe("incoming/outgoing context sections (section 4)", () => {
    const contextResult = {
      l2: { name: "Test L2" },
      l3: [],
      context: {
        incoming: [{ source_name: "main", source_type: "function" }],
        outgoing: [{ target_name: "utilFn", target_type: "function" }],
      },
    };

    it("prints an Incoming/Outgoing section in human format when context has data", async () => {
      mockQuery.mockResolvedValue(contextResult);

      await queryCommand("test-target", {});

      const logged = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
      expect(logged).toContain("main (function)");
      expect(logged).toContain("utilFn (function)");
    });

    it("does not print an Incoming/Outgoing section when context is null", async () => {
      mockQuery.mockResolvedValue({ l2: { name: "Test L2" }, l3: [], context: null });

      await queryCommand("test-target", {});

      const logged = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
      expect(logged).not.toContain("(function)");
    });

    it("includes <incoming>/<outgoing> elements in --format=prompt XML output when context has data", async () => {
      mockQuery.mockResolvedValue(contextResult);

      await queryCommand("test-target", { format: "prompt" });

      const logged = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
      expect(logged).toContain('<caller name="main" type="function"');
      expect(logged).toContain('<callee name="utilFn" type="function"');
    });

    it("formatPromptOutput omits <incoming>/<outgoing> elements when context is null", () => {
      const output = formatPromptOutput({ l2: { name: "Test L2" }, l3: [], context: null });

      expect(output).not.toContain("<incoming>");
      expect(output).not.toContain("<outgoing>");
    });
  });
});
