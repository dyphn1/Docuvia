import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import {
  queryCommand,
  formatPromptOutput,
} from "../../../src/commands/query.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { query: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    section: vi.fn(),
    table: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
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
      l2: { name: "authService", type: "module" },
      l3: [{ title: "switched to JWT", content: "details" }],
      context: {
        incoming: [{ name: "caller", linkType: "calls" }],
        outgoing: [{ name: "callee", linkType: "calls" }],
      },
    });

    expect(output).toContain("<docuvia_context>");
    expect(output).toContain('<l2_module name="authService" type="module">');
    expect(output).toContain('<l3_decision title="switched to JWT">');
    expect(output).toContain('<caller name="caller" relation="calls" />');
    expect(output).toContain('<callee name="callee" relation="calls" />');
  });

  it("includes the resolved file path on the l2_module tag when available", () => {
    const output = formatPromptOutput({
      l2: { name: "IGrain", type: "module", filePath: "src/IGrain.cs" },
      l3: [],
      context: null,
    });

    expect(output).toContain(
      '<l2_module name="IGrain" type="module" file="src/IGrain.cs">',
    );
  });

  it("labels incoming/outgoing edges by their actual relationship, not a generic type", () => {
    const output = formatPromptOutput({
      l2: { name: "IGrain", type: "module" },
      l3: [],
      context: {
        incoming: [{ name: "GrainImpl", linkType: "implements" }],
        outgoing: [{ name: "IGrainWithGuidKey", linkType: "extends" }],
      },
    });

    expect(output).toContain(
      '<caller name="GrainImpl" relation="implements" />',
    );
    expect(output).toContain(
      '<callee name="IGrainWithGuidKey" relation="extends" />',
    );
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
    vi.mocked(ui.log).mockReset();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error("Exit " + code);
    }) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the query and prints human-readable results by default", async () => {
    mockQuery.mockResolvedValue({
      l2: { name: "authService" },
      l3: [],
      context: null,
    });

    await queryCommand("authService");

    expect(mockQuery).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining("authService"),
    );
  });

  it("renders incoming/outgoing edges as Name/Relation tables under a section label", async () => {
    mockQuery.mockResolvedValue({
      l2: { name: "authService" },
      l3: [],
      context: {
        incoming: [{ name: "caller", linkType: "calls" }],
        outgoing: [{ name: "callee", linkType: "implements" }],
      },
    });

    await queryCommand("authService");

    expect(ui.section).toHaveBeenCalledWith(
      expect.stringContaining("Incoming"),
    );
    expect(ui.section).toHaveBeenCalledWith(
      expect.stringContaining("Outgoing"),
    );
    expect(ui.table).toHaveBeenCalledWith(expect.anything(), [
      ["caller", "calls"],
    ]);
    expect(ui.table).toHaveBeenCalledWith(expect.anything(), [
      ["callee", "implements"],
    ]);
  });

  it("prints the prompt XML block and skips the spinner when format is 'prompt'", async () => {
    mockQuery.mockResolvedValue({
      l2: { name: "authService" },
      l3: [],
      context: null,
    });

    await queryCommand("authService", { format: "prompt" });

    expect(ui.log).toHaveBeenCalledWith(
      expect.stringContaining("<docuvia_context>"),
    );
  });

  it("calls spinner.fail when docuviaApi.query() throws", async () => {
    mockQuery.mockRejectedValue(new Error("boom"));

    await queryCommand("authService");

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(process.exitCode).toBe(1);
  });

  it("warns and ignores an invalid (negative) --limit instead of passing it through silently", async () => {
    mockQuery.mockResolvedValue({ l2: null, l3: [], context: null });
    const setSpy = vi.spyOn(docuviaMemory, "set");

    await queryCommand("authService", { limit: -5 });

    expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("-5"));
    expect(setSpy).not.toHaveBeenCalledWith(expect.any(String), "limit", -5);
  });

  it("passes a valid --limit through to the memory scope unchanged", async () => {
    mockQuery.mockResolvedValue({ l2: null, l3: [], context: null });
    const setSpy = vi.spyOn(docuviaMemory, "set");

    await queryCommand("authService", { limit: 5 });

    expect(setSpy).toHaveBeenCalledWith(expect.any(String), "limit", 5);
    expect(ui.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Ignoring invalid --limit"),
    );
  });
});
