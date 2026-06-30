import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import parseAst from "../lib/ast/ast-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log("=== AST Query API Demo ===\n");

  // Test Python parsing with Query API
  const pyFile = path.join(__dirname, "fixtures", "demo-query.py");

  console.log("--- Python (Query API) ---");
  const pyResult = await parseAst(pyFile);
  if (pyResult.status === "done" && pyResult.file) {
    const output = await fs.readFile(pyResult.file, "utf-8");
    console.log(output);
  } else {
    console.error("Python parsing failed:", pyResult.reason);
  }

  // Test Rust parsing with Query API
  const rsFile = path.join(__dirname, "fixtures", "demo-query.rs");

  console.log("--- Rust (Query API) ---");
  const rsResult = await parseAst(rsFile);
  if (rsResult.status === "done" && rsResult.file) {
    const output = await fs.readFile(rsResult.file, "utf-8");
    console.log(output);
  } else {
    console.error("Rust parsing failed:", rsResult.reason);
  }

  // Test Go parsing with Query API
  const goFile = path.join(__dirname, "fixtures", "demo-query.go");

  console.log("--- Go (Query API) ---");
  const goResult = await parseAst(goFile);
  if (goResult.status === "done" && goResult.file) {
    const output = await fs.readFile(goResult.file, "utf-8");
    console.log(output);
  } else {
    console.error("Go parsing failed:", goResult.reason);
  }

  console.log("=== Query API Demo Complete ===");
}

run().catch(console.error);
