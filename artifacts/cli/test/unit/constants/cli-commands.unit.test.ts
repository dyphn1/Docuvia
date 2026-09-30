import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLI_COMMANDS,
  CLI_COMMAND_DESCRIPTIONS,
  CLI_COMMAND_FLAGS,
  getUsageText,
  getCommandUsageText,
} from "../../../src/constants/cli-commands.js";
import { CLI_FLAGS } from "../../../src/constants/cli-flags.js";
import { ArgParser } from "../../../src/utils/arg-parser.js";

function documentedCleanInvocations(): string[][] {
  const markdown = readFileSync(
    resolve(__dirname, "../../../../../docs/gitbook/user-guide/cli/clean.md"),
    "utf8",
  );
  const cleanCommand = `docuvia ${CLI_COMMANDS.CLEAN}`;
  const codeBlocks = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(
    ([, code]) => code,
  );

  return codeBlocks.flatMap((code) =>
    code.split(/\r?\n/).flatMap((line) => {
      const invocation = line.trim();
      if (
        invocation !== cleanCommand &&
        !invocation.startsWith(`${cleanCommand} `)
      ) {
        return [];
      }

      return [
        invocation
          .slice(cleanCommand.length)
          .trim()
          .split(/\s+/)
          .filter((argument) => argument.startsWith("-")),
      ];
    }),
  );
}

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

  it("[invalid-input] documents only flags registered for clean", () => {
    const invocations = documentedCleanInvocations();
    expect(invocations).not.toHaveLength(0);

    for (const flags of invocations) {
      for (const flag of flags) {
        expect(CLI_COMMAND_FLAGS[CLI_COMMANDS.CLEAN]).toContain(flag);
      }
    }
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

  it("allows the committed-range head ref on review", () => {
    const parser = new ArgParser(["--head", "HEAD"]);
    expect(() =>
      parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.REVIEW]),
    ).not.toThrow();
    expect(parser.getFlagValue(CLI_FLAGS.HEAD)).toBe("HEAD");
  });
});
