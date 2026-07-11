import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaApi } from "@workspace/ui-core";
import { queryCommand, formatPromptOutput } from "../../../src/commands/query.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { query: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
    })),
  },
}));

const mockQuery = vi.mocked(docuviaApi.query);

describe("formatPromptOutput()", () => {
  it("renders l2/l3/context into the docuvia_context XML block", () => {
    const output = formatPromptOutput({
      l2: { name: "authService" },
      l3: [{ title: "switched to JWT", content: "details" }],
      context: {
        incoming: [{ name: "caller", type: "module" }],
        outgoing: [{ name: "callee", type: "module" }],
      },
    });

    expect(output).toContain("<docuvia_context>");
    expect(output).toContain('<l2_module name="authService">');
    expect(output).toContain('<l3_decision title="switched to JWT">');
    expect(output).toContain('<caller name="caller" type="module" />');
    expect(output).toContain('<callee name="callee" type="module" />');
  });

  it("omits the l2/incoming/outgoing sections when there is nothing to report", () => {
    const output = formatPromptOutput({ l2: null, l3: [], context: null });
    expect(output).not.toContain("<l2_module");
    expect(output).not.toContain("<incoming>");
    expect(output).not.toContain("<outgoing>");
  });
});

describe("queryCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    mockQuery.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    vi.mocked(ui.info).mockReset();
    vi.mocked(ui.error).mockReset();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error("Exit " + code);
    }) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the query and prints human-readable results by default", async () => {
    mockQuery.mockResolvedValue({ l2: { name: "authService" }, l3: [], context: null });

    await queryCommand("authService");

    expect(mockQuery).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("authService"));
  });

  it("prints the prompt XML block and skips the spinner when format is 'prompt'", async () => {
    mockQuery.mockResolvedValue({ l2: { name: "authService" }, l3: [], context: null });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await queryCommand("authService", { format: "prompt" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("<docuvia_context>"));
    logSpy.mockRestore();
  });

  it("calls spinner.fail when docuviaApi.query() throws", async () => {
    mockQuery.mockRejectedValue(new Error("boom"));

    await queryCommand("authService");

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(process.exitCode).toBe(1);
  });
});
