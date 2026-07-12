import { describe, it, expect } from "vitest";
import {
  CLI_COMMANDS,
  CLI_COMMAND_DESCRIPTIONS,
  getUsageText,
} from "../../../src/constants/cli-commands.js";

describe("cli-commands", () => {
  it("exports commands object", () => {
    expect(CLI_COMMANDS.INIT).toBe("init");
  });

  it("exports descriptions for all commands", () => {
    Object.values(CLI_COMMANDS).forEach((cmd) => {
      expect(CLI_COMMAND_DESCRIPTIONS[cmd]).toBeDefined();
    });
  });

  it("getUsageText includes all commands and descriptions", () => {
    const usage = getUsageText();
    expect(usage).toContain("Usage:");

    Object.values(CLI_COMMANDS).forEach((cmd) => {
      expect(usage).toContain(`docuvia ${cmd}`);
      expect(usage).toContain(CLI_COMMAND_DESCRIPTIONS[cmd]);
    });
  });
});
