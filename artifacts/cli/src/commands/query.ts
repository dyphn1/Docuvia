import { QueryService, DI_TOKENS, DI_KEYS, container } from "@workspace/core";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

export function formatPromptOutput(results: any): string {
  let output = `<docuvia_context>\n`;
  if (results.l2) {
    output += `  <l2_module name="${results.l2.name}">\n`;
  }
  for (const l3 of results.l3) {
    output += `    <l3_decision title="${l3.title}" status="${l3.status || "unknown"}">\n      ${l3.content || ""}\n    </l3_decision>\n`;
  }
  if (results.l2) {
    output += `  </l2_module>\n`;
  }
  output += `</docuvia_context>`;
  return output;
}

export async function queryCommand(
  target?: string,
  options?: { local?: boolean; format?: "human" | "prompt" }
) {
  let queryTarget = target;

  if (!queryTarget) {
    if (!process.stdin.isTTY) {
      ui.error(UI_MESSAGES.QUERY_MISSING_TARGET);
      process.exit(1);
    }

    ui.header(UI_MESSAGES.QUERY_HEADER);
    queryTarget = await ui.askInput(UI_MESSAGES.QUERY_PROMPT_TARGET);

    if (!queryTarget) {
      ui.error(UI_MESSAGES.QUERY_MISSING_TARGET_NON_TTY);
      process.exit(1);
    }
  }

  const workspaceRoot = process.cwd(); // Assume CLI is run from workspace root
  const queryService = container.resolve<QueryService>(DI_TOKENS.QueryService);
  (queryService as any)[DI_KEYS.WORKSPACE_ROOT] = workspaceRoot;

  const isPromptFormat = options?.format === "prompt";
  let spinner;

  if (!isPromptFormat) {
    spinner = ui.spinner(UI_MESSAGES.QUERY_START + `"${queryTarget}"...`).start();
  }

  let results;
  try {
    results = await queryService.query(queryTarget, options || {});

    if (spinner) {
      spinner.succeed(UI_MESSAGES.QUERY_FOUND + `"${queryTarget}"`);
      console.log("");
    }
  } catch (error: any) {
    if (spinner) spinner.fail(UI_MESSAGES.QUERY_FAIL + error.message);
    else console.error(UI_MESSAGES.QUERY_FAIL + error.message);
    process.exit(1);
  }

  if (options?.format === "prompt") {
    console.log(formatPromptOutput(results));
  } else {
    ui.header(UI_MESSAGES.QUERY_CONTEXT_HEADER);
    if (results.l2) {
      ui.info(`${UI_MESSAGES.QUERY_L2_PREFIX} ${results.l2.name}`);
    } else {
      ui.warn(UI_MESSAGES.QUERY_NO_L2);
    }
    console.log(``);
    for (const l3 of results.l3) {
      ui.success(
        `${UI_MESSAGES.QUERY_L3_PREFIX} ${l3.title} (${l3.status || UI_MESSAGES.QUERY_UNKNOWN_STATUS})`
      );
      if (l3.content) {
        console.log(`  ${l3.content.split("\n").join("\n  ")}`);
      }
      console.log(``);
    }
    console.log("");
  }
}
