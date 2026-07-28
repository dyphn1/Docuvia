import { select, confirm, input, checkbox } from "@inquirer/prompts";
import pc from "picocolors";
import ora from "ora";
import { renderBanner, renderTable, type TableColumn } from "./table.js";
import { SECTION_ICON } from "../constants/box-drawing.js";

const SPINNER_COLOR = "cyan";
const UI_ICONS = {
  INFO: "ℹ",
  SUCCESS: "✔",
  WARN: "⚠",
  ERROR: "✖",
} as const;

/** picocolors' default export forces color on unconditionally on win32 and honors ambient
 *  `FORCE_COLOR`, regardless of whether stdout is actually a terminal -- both wrong for this
 *  CLI's "stays plain-text/parseable when piped to a non-TTY reader" contract (box-drawing.ts,
 *  table.ts). Gate on a real TTY so redirected/piped output (tests, log files, AI agents) never
 *  carries ANSI escape codes. */
const color = pc.createColors(
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
);

export const ui = {
  spinner: (text: string) => {
    return ora({
      text,
      color: SPINNER_COLOR,
    });
  },

  info: (msg: string) => console.log(color.cyan(`${UI_ICONS.INFO} ${msg}`)),
  success: (msg: string) =>
    console.log(color.green(`${UI_ICONS.SUCCESS} ${msg}`)),
  warn: (msg: string) => console.warn(color.yellow(`${UI_ICONS.WARN} ${msg}`)),
  error: (msg: string) => console.error(color.red(`${UI_ICONS.ERROR} ${msg}`)),
  log: (msg?: string) => console.log(msg ?? ""),

  /** Every command's top-of-run banner -- one shared box-drawn style (IFCE CLI output-style
   *  pass) so the terminal output looks the same regardless of which command produced it, and
   *  stays plain-text/parseable when piped to a non-TTY reader (an AI agent, a log file). */
  header: (title: string) => {
    console.log();
    for (const line of renderBanner(title)) console.log(color.cyan(line));
    console.log();
  },

  /** A labeled sub-section within a command's output, e.g. grouping `doctor`'s diagnostics by
   *  category ahead of each `ui.table()` call. */
  section: (title: string) => {
    console.log();
    console.log(color.bold(color.cyan(`${SECTION_ICON} ${title}`)));
  },

  /** Renders a bordered table -- see `renderTable` (`./table.js`) for the layout/wrapping rules. */
  table: (columns: TableColumn[], rows: string[][]) => {
    for (const line of renderTable(columns, rows)) console.log(line);
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
