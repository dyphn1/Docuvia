import { describe, it, expect, vi, afterEach } from "vitest";
import { ui } from "../../../src/ui/wizard.js";
import { select, confirm, input } from "@inquirer/prompts";

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
}));

describe("Wizard UI", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("askConfirm calls confirm prompt", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const res = await ui.askConfirm("Are you sure?");
    expect(confirm).toHaveBeenCalledWith({ message: "Are you sure?", default: true });
    expect(res).toBe(true);
  });

  it("askSelect calls select prompt", async () => {
    vi.mocked(select).mockResolvedValue("opt1" as never);
    const res = await ui.askSelect("Choose:", [{ name: "1", value: "opt1" }]);
    expect(select).toHaveBeenCalledWith({
      message: "Choose:",
      choices: [{ name: "1", value: "opt1" }],
    });
    expect(res).toBe("opt1");
  });

  it("askInput calls input prompt", async () => {
    vi.mocked(input).mockResolvedValue("test");
    const res = await ui.askInput("Enter value:", "default");
    expect(input).toHaveBeenCalledWith({ message: "Enter value:", default: "default" });
    expect(res).toBe("test");
  });
});
