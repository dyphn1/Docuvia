import { QueryService, DI_TOKENS, DI_KEYS } from "@workspace/core";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

export function formatPromptOutput(results: any): string {
  let output = `<docuvia_context>\n`;
  if (results.l2) {
    output += `  <l2_module name="${results.l2.name}">\n`;
  }
  for (const l3 of results.l3) {
    output += `    <l3_decision title="${l3.title}" status="${l3.status || UI_MESSAGES.QUERY_UNKNOWN_STATUS}">\n      ${l3.content || ""}\n    </l3_decision>\n`;
  }
  if (results.l2) {
    output += `  </l2_module>\n`;
  }

  const incoming = results.context?.incoming ?? [];
  const outgoing = results.context?.outgoing ?? [];
  if (incoming.length > 0 || outgoing.length > 0) {
    if (incoming.length > 0) {
      output += `  <incoming>\n`;
      for (const i of incoming) {
        output += `    <caller name="${i.source_name}" type="${i.source_type}" />\n`;
      }
      output += `  </incoming>\n`;
    }
    if (outgoing.length > 0) {
      output += `  <outgoing>\n`;
      for (const o of outgoing) {
        output += `    <callee name="${o.target_name}" type="${o.target_type}" />\n`;
      }
      output += `  </outgoing>\n`;
    }
  }

  output += `</docuvia_context>`;
  return output;
}

function printHumanResults(results: any): void {
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

  const incoming = results.context?.incoming ?? [];
  const outgoing = results.context?.outgoing ?? [];
  if (incoming.length > 0) {
    ui.header(UI_MESSAGES.QUERY_INCOMING_HEADER);
    for (const i of incoming) {
      console.log(`  ${i.source_name} (${i.source_type})`);
    }
    console.log(``);
  }
  if (outgoing.length > 0) {
    ui.header(UI_MESSAGES.QUERY_OUTGOING_HEADER);
    for (const o of outgoing) {
      console.log(`  ${o.target_name} (${o.target_type})`);
    }
    console.log(``);
  }

  console.log("");
}

async function resolveQueryTarget(target?: string): Promise<string> {
  if (target) return target;

  if (!process.stdin.isTTY) {
    ui.error(UI_MESSAGES.QUERY_MISSING_TARGET);
    process.exit(1);
  }

  ui.header(UI_MESSAGES.QUERY_HEADER);
  const queryTarget = await ui.askInput(UI_MESSAGES.QUERY_PROMPT_TARGET);

  if (!queryTarget) {
    ui.error(UI_MESSAGES.QUERY_MISSING_TARGET_NON_TTY);
    process.exit(1);
  }

  return queryTarget;
}

export async function queryCommand(
  target?: string,
  options?: { local?: boolean; format?: "human" | "prompt" },
  workspaceRoot: string = process.cwd()
) {
  const queryTarget = await resolveQueryTarget(target);

  const queryService = resolveConfiguredService<QueryService>(DI_TOKENS.QueryService, {
    [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot,
  });

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

  if (isPromptFormat) {
    console.log(formatPromptOutput(results));
  } else {
    printHumanResults(results);
  }
}
