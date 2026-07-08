import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { statusCommand } from "../../../src/commands/status.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, DI_KEYS, container } from "@workspace/core";

const mockStatus = vi.fn();
container.register(DI_TOKENS.StatusService, { getStatus: mockStatus });

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
  },
}));

describe("statusCommand", () => {
  let exitSpy: any;
  let logSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockStatus.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully get status", async () => {
    mockStatus.mockResolvedValue({ projects: 1, l2Nodes: 2, l3Nodes: 3 });

    await statusCommand();

    expect(mockStatus).toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("Projects"));
  });
});
