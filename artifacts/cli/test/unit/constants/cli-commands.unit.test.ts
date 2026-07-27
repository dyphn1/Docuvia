import { describe, it, expect } from "vitest";
import {
  CLI_COMMANDS,
  CLI_COMMAND_DESCRIPTIONS,
  CLI_COMMAND_FLAGS,
  getUsageText,
  getCommandUsageText,
} from "../../../src/constants/cli-commands.js";
import { CLI_FLAGS } from "../../../src/constants/cli-flags.js";

describe("cli-commands", () => {
  it("exports commands object", () => {
    expect(CLI_COMMANDS.INIT).toBe("init");
  });

  it("exports descriptions for all commands", () => {
    Object.values(CLI_COMMANDS).forEach((cmd) => {
      expect(CLI_COMMAND_DESCRIPTIONS[cmd]).toBeDefined();
    });
  });

  it("exports a flag list for every command", () => {
    Object.values(CLI_COMMANDS).forEach((cmd) => {
      expect(CLI_COMMAND_FLAGS[cmd]).toBeDefined();
    });
  });

  it("getUsageText includes all commands, descriptions, and the --help/--version/--interactive options", () => {
    const usage = getUsageText();
    expect(usage).toContain("Usage:");

    Object.values(CLI_COMMANDS).forEach((cmd) => {
      expect(usage).toContain(`docuvia ${cmd}`);
      expect(usage).toContain(CLI_COMMAND_DESCRIPTIONS[cmd]);
    });

    expect(usage).toContain("--help");
    expect(usage).toContain("--version");
    expect(usage).toContain("--interactive");
  });

  describe("getCommandUsageText", () => {
    it("includes the command name and description", () => {
      const usage = getCommandUsageText(CLI_COMMANDS.STATUS);
      expect(usage).toContain("docuvia status");
      expect(usage).toContain(CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.STATUS]);
    });

    it("omits a Flags section for a command with no flags", () => {
      const usage = getCommandUsageText(CLI_COMMANDS.STATUS);
      expect(usage).not.toContain("Flags:");
    });

    it("lists every flag from CLI_COMMAND_FLAGS for a command that has some", () => {
      const usage = getCommandUsageText(CLI_COMMANDS.DOCTOR);
      expect(usage).toContain("Flags:");
      CLI_COMMAND_FLAGS[CLI_COMMANDS.DOCTOR].forEach((flag) => {
        expect(usage).toContain(flag);
      });
    });

    it("includes --interactive/-i for commands that can prompt", () => {
      const usage = getCommandUsageText(CLI_COMMANDS.INIT);
      expect(usage).toContain(CLI_FLAGS.INTERACTIVE);
      expect(usage).toContain(CLI_FLAGS.INTERACTIVE_SHORT);
    });
  });
});
