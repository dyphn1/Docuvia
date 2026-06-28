import { QueryService } from "@workspace/core";

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
  target: string,
  options: { local?: boolean; format?: "human" | "prompt" }
) {
  const workspaceRoot = process.cwd(); // Assume CLI is run from workspace root
  const queryService = new QueryService(workspaceRoot);

  let results;
  try {
    results = await queryService.query(target, options);
  } catch (error: any) {
    console.error("Query Error:", error);
    process.exit(1);
  }

  if (options.format === "prompt") {
    console.log(formatPromptOutput(results));
  } else {
    console.log(`\x1b[1m\x1b[36m=== Docuvia Context ===\x1b[0m\n`);
    if (results.l2) {
      console.log(`\x1b[35m[L2 Module]\x1b[0m ${results.l2.name}`);
    } else {
      console.log(`\x1b[33mNo matching L2 module found. Showing global results.\x1b[0m`);
    }
    console.log(``);
    for (const l3 of results.l3) {
      console.log(
        `\x1b[32m[Decision]\x1b[0m ${l3.title} \x1b[90m(${l3.status || "unknown"})\x1b[0m`
      );
      if (l3.content) {
        console.log(`  ${l3.content.split("\n").join("\n  ")}`);
      }
      console.log(``);
    }
    console.log(`\x1b[1m\x1b[36m=======================\x1b[0m`);
  }
}
