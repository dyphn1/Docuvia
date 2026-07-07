import { QueryService } from "@workspace/core";
import { ui } from "../ui/wizard.js";

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
      ui.error("Missing required argument: <target>");
      process.exit(1);
    }

    ui.header("Query Knowledge Graph");
    queryTarget = await ui.askInput("Enter search target (e.g., function name, concept):");

    if (!queryTarget) {
      ui.error("Query target is required.");
      process.exit(1);
    }
  }

  const workspaceRoot = process.cwd(); // Assume CLI is run from workspace root
  const queryService = new QueryService(workspaceRoot);

  const isPromptFormat = options?.format === "prompt";
  let spinner;

  if (!isPromptFormat) {
    spinner = ui.spinner(`Querying for "${queryTarget}"...`).start();
  }

  let results;
  try {
    results = await queryService.query(queryTarget, options || {});

    if (spinner) {
      spinner.succeed(`Found results for "${queryTarget}"`);
      console.log("");
    }
  } catch (error: any) {
    if (spinner) spinner.fail(`Query Error: ${error.message}`);
    else console.error("Query Error:", error.message);
    process.exit(1);
  }

  if (options?.format === "prompt") {
    console.log(formatPromptOutput(results));
  } else {
    ui.header("Docuvia Context");
    if (results.l2) {
      ui.info(`[L2 Module] ${results.l2.name}`);
    } else {
      ui.warn(`No matching L2 module found. Showing global results.`);
    }
    console.log(``);
    for (const l3 of results.l3) {
      ui.success(`[Decision] ${l3.title} (${l3.status || "unknown"})`);
      if (l3.content) {
        console.log(`  ${l3.content.split("\n").join("\n  ")}`);
      }
      console.log(``);
    }
    console.log("");
  }
}
