import { select, confirm, input, checkbox } from "@inquirer/prompts";
import pc from "picocolors";
import ora from "ora";

const SPINNER_COLOR = "cyan";
const UI_ICONS = {
  INFO: "ℹ",
  SUCCESS: "✔",
  WARN: "⚠",
  ERROR: "✖",
} as const;

export const ui = {
  spinner: (text: string) => {
    return ora({
      text,
      color: SPINNER_COLOR,
    });
  },

  info: (msg: string) => console.log(pc.cyan(`${UI_ICONS.INFO} ${msg}`)),
  success: (msg: string) => console.log(pc.green(`${UI_ICONS.SUCCESS} ${msg}`)),
  warn: (msg: string) => console.warn(pc.yellow(`${UI_ICONS.WARN} ${msg}`)),
  error: (msg: string) => console.error(pc.red(`${UI_ICONS.ERROR} ${msg}`)),
  log: (msg?: string) => console.log(msg ?? ""),

  header: (title: string) => {
    console.log();
    console.log(pc.bgCyan(pc.black(` ${title} `)));
    console.log();
  },

  askConfirm: async (message: string, defaultAnswer = true) => {
    return await confirm({ message, default: defaultAnswer });
  },

  askSelect: async (
    message: string,
    choices: { name: string; value: string; description?: string }[],
  ) => {
    return await select({
      message,
      choices,
    });
  },

  askCheckbox: async (
    message: string,
    choices: { name: string; value: string; checked?: boolean }[],
  ) => {
    return await checkbox({
      message,
      choices,
    });
  },

  askInput: async (message: string, defaultAnswer?: string) => {
    return await input({ message, default: defaultAnswer });
  },
};
