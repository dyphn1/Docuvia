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
      l2: { name: "authService", type: "module", matchType: "exact" },
      l3: [{ title: "switched to JWT", content: "details" }],
      context: {
        incoming: [{ name: "caller", linkType: "calls" }],
        outgoing: [{ name: "callee", linkType: "calls" }],
      },
    });

    expect(output).toContain("<docuvia_context>");
    expect(output).toContain(
      '<l2_module name="authService" type="module" match_type="exact">',
    );
    expect(output).toContain('<l3_decision title="switched to JWT">');
    expect(output).toContain('<caller name="caller" relation="calls" />');
    expect(output).toContain('<callee name="callee" relation="calls" />');
  });

  it("includes the resolved file path on the l2_module tag when available", () => {
    const output = formatPromptOutput({
      l2: {
        name: "IGrain",
        type: "module",
        filePath: "src/IGrain.cs",
        matchType: "exact",
      },
      l3: [],
      context: null,
    });

    expect(output).toContain(
      '<l2_module name="IGrain" type="module" file="src/IGrain.cs" match_type="exact">',
    );
  });

  it.each([
    ["exact", "exact"],
    ["keyword", "keyword"],
    ["neighbor", "neighbor"],
  ] as const)(
    'renders match_type="%s" on the l2_module tag for a %s match',
    (matchType, expected) => {
      const output = formatPromptOutput({
        l2: { name: "authService", type: "module", matchType },
        l3: [],
        context: null,
      });

      expect(output).toContain(`match_type="${expected}"`);
    },
  );

  it("labels incoming/outgoing edges by their actual relationship, not a generic type", () => {
    const output = formatPromptOutput({
      l2: { name: "IGrain", type: "module", matchType: "exact" },
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

  it("renders the unprocessed tier_b_status tag on both empty edge lists when tierBCoverage is present (typescript-cli-benchmark.md §5.3/§5.7 item 2)", () => {
    const output = formatPromptOutput({
      l2: { name: "authService", type: "module", matchType: "exact" },
      l3: [],
      context: {
        incoming: [],
        outgoing: [],
        tierBCoverage: {
          ownFileLastProcessedAt: null,
          workspaceFilesProcessed: 3,
          workspaceFilesTotal: 10,
        },
      },
    });

    expect(output).toContain('tier_b_status="unprocessed"');
    expect(output).toContain("<incoming");
    expect(output).toContain("<outgoing");
    expect(output).toContain("--escalate-to-lsp --full");
    // Never reuses the existing <caller>/<callee> shape.
    expect(output).not.toContain("<caller");
    expect(output).not.toContain("<callee");
  });

  it("renders nothing for incoming/outgoing when both lists are empty and tierBCoverage is undefined -- today's exact behavior, unchanged (regression guard)", () => {
    const output = formatPromptOutput({
      l2: { name: "authService", type: "module", matchType: "exact" },
      l3: [],
      context: { incoming: [], outgoing: [] },
    });

    expect(output).not.toContain("<incoming");
    expect(output).not.toContain("<outgoing");
    expect(output).not.toContain("tier_b_status");
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
      l2: { name: "authService", matchType: "exact" },
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

  it.each([
    ["exact", "(exact match)"],
    ["keyword", "(keyword match -- verify with Grep/Glob if unsure)"],
    ["neighbor", "(neighbor match)"],
  ] as const)(
    'shows a "%s" hint after the module name for a %s match (human-readable format)',
    async (matchType, expectedHint) => {
      mockQuery.mockResolvedValue({
        l2: { name: "authService", matchType },
        l3: [],
        context: null,
      });

      await queryCommand("authService");

      expect(ui.info).toHaveBeenCalledWith(
        expect.stringContaining(expectedHint),
      );
    },
  );

  it("renders incoming/outgoing edges as Name/Relation tables under a section label", async () => {
    mockQuery.mockResolvedValue({
      l2: { name: "authService", matchType: "exact" },
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

  it("prints the Tier B unprocessed warning under each empty section header when tierBCoverage is present (human-readable format)", async () => {
    mockQuery.mockResolvedValue({
      l2: { name: "authService", matchType: "exact" },
      l3: [],
      context: {
        incoming: [],
        outgoing: [],
        tierBCoverage: {
          ownFileLastProcessedAt: null,
          workspaceFilesProcessed: 3,
          workspaceFilesTotal: 10,
        },
      },
    });

    await queryCommand("authService");

    expect(ui.section).toHaveBeenCalledWith(
      expect.stringContaining("Incoming"),
    );
    expect(ui.section).toHaveBeenCalledWith(
      expect.stringContaining("Outgoing"),
    );
    expect(ui.warn).toHaveBeenCalledWith(
      expect.stringContaining("7 of 10 tracked file(s)"),
    );
    expect(ui.warn).toHaveBeenCalledWith(
      expect.stringContaining("No callees found"),
    );
  });

  it("prints nothing extra when both edge lists are empty and tierBCoverage is undefined -- today's exact output, unchanged (regression guard)", async () => {
    mockQuery.mockResolvedValue({
      l2: { name: "authService", matchType: "exact" },
      l3: [],
      context: { incoming: [], outgoing: [] },
    });

    await queryCommand("authService");

    expect(ui.section).not.toHaveBeenCalledWith(
      expect.stringContaining("Incoming"),
    );
    expect(ui.section).not.toHaveBeenCalledWith(
      expect.stringContaining("Outgoing"),
    );
    expect(ui.warn).not.toHaveBeenCalled();
  });

  it("prints the prompt XML block and skips the spinner when format is 'prompt'", async () => {
    mockQuery.mockResolvedValue({
      l2: { name: "authService", matchType: "exact" },
      l3: [],
      context: null,
    });

    await queryCommand("authService", { format: "prompt" });

    expect(ui.log).toHaveBeenCalledWith(
      expect.stringContaining("<docuvia_context>"),
    );
  });

  it("prints the structured result as JSON and skips the spinner when format is 'json'", async () => {
    const result = {
      l2: { name: "authService", matchType: "exact" },
      l3: [{ title: "switched to JWT", content: "details" }],
      context: {
        incoming: [{ name: "caller", linkType: "calls" }],
        outgoing: [],
      },
    };
    mockQuery.mockResolvedValue(result);

    await queryCommand("authService", { format: "json" });

    expect(ui.log).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    // Structured output must never carry banner/spinner/table decoration on stdout.
    expect(spinnerSucceed).not.toHaveBeenCalled();
    expect(ui.info).not.toHaveBeenCalled();
    expect(ui.section).not.toHaveBeenCalled();
    expect(ui.table).not.toHaveBeenCalled();
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
