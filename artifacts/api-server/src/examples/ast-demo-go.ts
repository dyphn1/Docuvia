import path from "path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import parseAst from "../lib/ast/ast-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const fixtureFile = path.join(__dirname, "fixtures", "demo.go");

  console.log(`Parsing file: ${fixtureFile}`);
  const result = await parseAst(fixtureFile);

  if (result.status === "done" && result.file) {
    console.log(`AST successfully parsed! Output written to: ${result.file}`);
    const output = await fs.readFile(result.file, "utf-8");
    console.log("\n--- Parsed JSON Lines ---");
    console.log(output);
    console.log("---------------------------");
  } else {
    console.error("AST parsing failed:", result.reason);
  }
}

run().catch(console.error);
