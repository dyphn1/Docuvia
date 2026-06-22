import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import parseAst from "../lib/ast/ast-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log("Generating dummy Ruby file to parse...");
  const dummyFile = path.join(__dirname, "dummy.rb");
  await fs.writeFile(
    dummyFile,
    `
require 'json'
require_relative 'my_helper'

module MyModule
  class MyTestClass
    def hello
      puts "Hello World"
    end
  end

  def self.module_method
    puts "Module method"
  end
end

def my_test_function
  puts "Testing"
end

class AnotherClass < MyModule::MyTestClass
  def initialize
    @value = 42
  end

  def greet(name)
    puts "Hello, #{name}!"
  end
end

obj = AnotherClass.new
obj.greet("World")
MyModule::MyTestClass.new.hello
`,
    "utf-8"
  );

  console.log(`Parsing file: ${dummyFile}`);
  const result = await parseAst(dummyFile);

  if (result.status === "done" && result.file) {
    console.log(`AST successfully parsed! Output written to: ${result.file}`);
    const output = await fs.readFile(result.file, "utf-8");
    console.log("\n--- Parsed JSON Lines ---");
    console.log(output);
    console.log("---------------------------");
  } else {
    console.error("AST parsing failed:", result.reason);
  }

  // Cleanup
  await fs.rm(dummyFile);
}

run().catch(console.error);
