import { select, confirm, input } from "@inquirer/prompts";
import pc from "picocolors";
import ora from "ora";

export const ui = {
  spinner: (text: string) => {
    return ora({
      text,
      color: "cyan",
    });
  },

  info: (msg: string) => console.log(pc.cyan(`ℹ ${msg}`)),
  success: (msg: string) => console.log(pc.green(`✔ ${msg}`)),
  warn: (msg: string) => console.warn(pc.yellow(`⚠ ${msg}`)),
  error: (msg: string) => console.error(pc.red(`✖ ${msg}`)),

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
    choices: { name: string; value: string; description?: string }[]
  ) => {
    return await select({
      message,
      choices,
    });
  },

  askInput: async (message: string, defaultAnswer?: string) => {
    return await input({ message, default: defaultAnswer });
  },
};
