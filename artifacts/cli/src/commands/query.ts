import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  type LocalQueryResult,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

export function formatPromptOutput(result: LocalQueryResult): string {
  const lines: string[] = [];
  lines.push("<docuvia_context>");
  if (result.l2) {
    lines.push('  <l2_module name="' + result.l2.name + '">');
  }
  for (const l3 of result.l3) {
    lines.push('    <l3_decision title="' + l3.title + '">');
    lines.push("      " + (l3.content || ""));
    lines.push("    </l3_decision>");
  }
  if (result.l2) {
    lines.push("  </l2_module>");
  }

  const incoming = result.context?.incoming ?? [];
  const outgoing = result.context?.outgoing ?? [];
  if (incoming.length > 0 || outgoing.length > 0) {
    if (incoming.length > 0) {
      lines.push("  <incoming>");
      for (const i of incoming) {
        lines.push(
          '    <caller name="' + i.name + '" type="' + i.type + '" />',
        );
      }
      lines.push("  </incoming>");
    }
    if (outgoing.length > 0) {
      lines.push("  <outgoing>");
      for (const o of outgoing) {
        lines.push(
          '    <callee name="' + o.name + '" type="' + o.type + '" />',
        );
      }
      lines.push("  </outgoing>");
    }
  }

  lines.push("</docuvia_context>");
  return lines.join("\n");
}

function printHumanResults(result: LocalQueryResult): void {
  ui.header(UI_MESSAGES.QUERY_CONTEXT_HEADER);
  if (result.l2) {
    ui.info(UI_MESSAGES.QUERY_L2_PREFIX + result.l2.name);
  } else {
    ui.warn(UI_MESSAGES.QUERY_NO_L2);
  }
  console.log("");
  for (const l3 of result.l3) {
    ui.success(UI_MESSAGES.QUERY_L3_PREFIX + l3.title);
    if (l3.content) {
      console.log("  " + l3.content.split("\n").join("\n  "));
    }
    console.log("");
  }

  const incoming = result.context?.incoming ?? [];
  const outgoing = result.context?.outgoing ?? [];
  if (incoming.length > 0) {
    ui.header(UI_MESSAGES.QUERY_INCOMING_HEADER);
    for (const i of incoming) {
      console.log("  " + i.name + " (" + i.type + ")");
    }
    console.log("");
  }
  if (outgoing.length > 0) {
    ui.header(UI_MESSAGES.QUERY_OUTGOING_HEADER);
    for (const o of outgoing) {
      console.log("  " + o.name + " (" + o.type + ")");
    }
    console.log("");
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

/** Thin caller of docuviaApi.query() - mirrors init.ts's Presentation-layer responsibilities. */
export async function queryCommand(
  target?: string,
  options: { format?: "human" | "prompt"; limit?: number } = {},
  cwd: string = process.cwd(),
) {
  const queryTarget = await resolveQueryTarget(target);
  const isPromptFormat = options.format === "prompt";

  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  let spinner: ReturnType<typeof ui.spinner> | undefined;
  if (!isPromptFormat) {
    spinner = ui
      .spinner(UI_MESSAGES.QUERY_START + '"' + queryTarget + '"...')
      .start();
    logger.onLog((event) => {
      if (event.level === "info" && spinner) spinner.text = event.message;
    });
  }

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, "workspaceRoot", cwd);
  docuviaMemory.set(scopeId, "target", queryTarget);
  if (options.limit) docuviaMemory.set(scopeId, "limit", options.limit);

  let result: LocalQueryResult;
  try {
    result = await docuviaApi.query(scopeId, logger);
    if (spinner) {
      spinner.succeed(UI_MESSAGES.QUERY_FOUND + '"' + queryTarget + '"');
      console.log("");
    }
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    if (spinner) spinner.fail(UI_MESSAGES.QUERY_FAIL + message);
    else console.error(UI_MESSAGES.QUERY_FAIL + message);
    process.exitCode = 1;
    return;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }

  if (isPromptFormat) {
    console.log(formatPromptOutput(result));
  } else {
    printHumanResults(result);
  }
}
