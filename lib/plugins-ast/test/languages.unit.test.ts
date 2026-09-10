import { describe, it, expect, beforeAll } from "vitest";
import { Parser, Language, type Node } from "web-tree-sitter";
import { DefaultProvider } from "@workspace/ast-core";
import {
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  cConfig,
  cppConfig,
  csharpConfig,
  goConfig,
  javaConfig,
  phpConfig,
  rubyConfig,
  rustConfig,
} from "../src/languages/index.js";
import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

function resolveWasmPath(wasmFile: string): string {
  const docuviaRoot = path.resolve(__dirname, "../../../../");
  try {
    const packagePath = require.resolve("tree-sitter-wasms/package.json", {
      paths: [__dirname, docuviaRoot],
    });
    const wasmPath = path.join(path.dirname(packagePath), "out", wasmFile);
    if (fs.existsSync(wasmPath)) return wasmPath;
  } catch {
    // fall through
  }
  const candidates = [
    path.resolve(docuviaRoot, `node_modules/tree-sitter-wasms/out/${wasmFile}`),
    path.resolve(
      __dirname,
      `../../../node_modules/tree-sitter-wasms/out/${wasmFile}`,
    ),
    path.resolve(
      docuviaRoot,
      `node_modules/.pnpm/tree-sitter-wasms@0.1.13/node_modules/tree-sitter-wasms/out/${wasmFile}`,
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${wasmFile} not found. Tried: ${candidates.join(", ")}`);
}

function resolveCallableName(node: Node): string {
  const nameField = node.childForFieldName("name");
  if (nameField) return nameField.text;

  if (
    node.type === "function_definition" ||
    node.type === "function_declarator"
  ) {
    const inner = node.childForFieldName("declarator");
    if (inner) return resolveCallableName(inner);
  }

  if (node.type === "arrow_function" || node.type === "function_expression") {
    return findEnclosingBindingName(node);
  }

  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    if (fn) return resolveCallableName(fn);
  }

  return tryDirectName(node) ?? node.text;
}

function tryDirectName(node: Node): string | undefined {
  if (
    node.type === "identifier" ||
    node.type === "field_identifier" ||
    node.type === "type_identifier"
  ) {
    return node.text;
  }
  return undefined;
}

function findEnclosingBindingName(node: Node): string {
  let current: Node | null = node.parent;
  while (current) {
    if (current.type === "variable_declarator") {
      const id = current.childForFieldName("name");
      if (id) return id.text;
    }
    if (current.type === "assignment_expression" || current.type === "pair") {
      const key = current.childForFieldName("key");
      if (key) return key.text;
    }
    current = current.parent;
  }
  return "anonymous";
}

describe("Language Configurations", () => {
  const configs = [
    { name: "TypeScript", config: typescriptConfig },
    { name: "JavaScript", config: javascriptConfig },
    { name: "Python", config: pythonConfig },
    { name: "C", config: cConfig },
    { name: "C++", config: cppConfig },
    { name: "C#", config: csharpConfig },
    { name: "Go", config: goConfig },
    { name: "Java", config: javaConfig },
    { name: "PHP", config: phpConfig },
    { name: "Ruby", config: rubyConfig },
    { name: "Rust", config: rustConfig },
  ];

  configs.forEach(({ name, config }) => {
    it(`should have valid configuration for ${name}`, () => {
      expect(config).toBeDefined();
      expect(Array.isArray(config.extensions)).toBe(true);
      expect(config.extensions.length).toBeGreaterThanOrEqual(1);
      for (const ext of config.extensions) {
        expect(ext.startsWith(".")).toBe(true);
      }
      expect(typeof config.wasm_file).toBe("string");
      expect(config.wasm_file.endsWith(".wasm")).toBe(true);
      expect(config.queries).toBeDefined();
    });
  });
});

interface LanguageFixture {
  name: string;
  config: (typeof configs)[number]["config"];
  source: string;
  expectedFunctions: string[];
  expectedCalls: string[];
  expectedImports?: string[];
  expectedClasses?: string[];
}

const FIXTURES: LanguageFixture[] = [
  {
    name: "TypeScript",
    config: typescriptConfig,
    source: `
import { readFile } from "fs";
import path from "path";
function greet(name: string) { return "hello"; }
function add(a: number, b: number) { return a + b; }
const handler = () => { doStuff(); };
class Calculator { multiply(x: number) { return x * 2; } }
readFile("test.txt");
greet("world");
`,
    expectedFunctions: ["greet", "add", "handler", "multiply"],
    expectedCalls: ["readFile", "doStuff", "greet"],
    expectedImports: ["fs", "path"],
    expectedClasses: ["Calculator"],
  },
  {
    name: "JavaScript",
    config: javascriptConfig,
    source: `
import { readFile } from "fs";
function greet(name) { return "hello"; }
const handler = () => { doStuff(); };
class Foo { bar() { return 1; } }
readFile("test.txt");
greet("world");
`,
    expectedFunctions: ["greet", "handler", "bar"],
    expectedCalls: ["readFile", "doStuff", "greet"],
    expectedImports: ["fs"],
    expectedClasses: ["Foo"],
  },
  {
    name: "Python",
    config: pythonConfig,
    source: `
import os
from sys import argv
def greet(name):
    return "hello"
class Calculator:
    def add(self, x, y):
        return x + y
greet("world")
os.path.join("a", "b")
`,
    expectedFunctions: ["greet", "add"],
    expectedCalls: ["greet", "os.path.join"],
    expectedImports: ["os", "sys"],
    expectedClasses: ["Calculator"],
  },
  {
    name: "Go",
    config: goConfig,
    source: `
package main
import "fmt"
func greet(name string) string { return "hello" }
func add(a, b int) int { return a + b }
type Calculator struct{}
func (c Calculator) Multiply(x int) int { return x * 2 }
func main() { fmt.Println("hello"); greet("world") }
`,
    expectedFunctions: ["greet", "add", "Multiply", "main"],
    expectedCalls: ["fmt.Println", "greet"],
    expectedImports: ["fmt"],
    expectedClasses: ["Calculator"],
  },
  {
    name: "Rust",
    config: rustConfig,
    source: `
use std::io;
fn greet(name: &str) -> String { String::from("hello") }
fn compute(x: i32) -> i32 { x * 2 }
struct Calculator;
impl Calculator { fn multiply(x: i32) -> i32 { x * 2 } }
fn main() { greet("world"); compute(5); }
`,
    expectedFunctions: ["greet", "compute", "multiply", "main"],
    expectedCalls: ["greet", "compute"],
    expectedImports: ["std::io"],
    expectedClasses: ["Calculator"],
  },
  {
    name: "C++",
    config: cppConfig,
    source: `
int add(int a, int b) { return a + b; }
int compute(int x) { return x * 2; }
class Calculator { public: int multiply(int x); };
int Calculator::multiply(int x) { return x * 2; }
int main() { Calculator c; add(1, 2); compute(3); c.multiply(5); }
`,
    expectedFunctions: ["add", "compute", "multiply", "main"],
    expectedCalls: ["add", "compute", "c.multiply"],
    expectedImports: [],
    expectedClasses: ["Calculator"],
  },
  {
    name: "PHP",
    config: phpConfig,
    source: `
<?php
use App\\Services\\Calculator;
function greet($name) { return "hello"; }
class UserService { public function add($x, $y) { return $x + $y; } }
greet("world");
`,
    expectedFunctions: ["greet", "add"],
    expectedCalls: ["greet"],
    expectedImports: ["App\\Services\\Calculator"],
    expectedClasses: ["UserService"],
  },
  {
    name: "Ruby",
    config: rubyConfig,
    source: `
require "json"
def greet(name)
  "hello"
end
class Calculator
  def multiply(x)
    x * 2
  end
end
greet("world")
`,
    expectedFunctions: ["greet", "multiply"],
    expectedCalls: ["greet"],
    expectedImports: ["json"],
    expectedClasses: ["Calculator"],
  },
  {
    name: "Java",
    config: javaConfig,
    source: `
import java.util.List;
import java.util.ArrayList;
class Calculator { public int add(int a, int b) { return a + b; } }
public class Main { public static void main(String[] args) { Calculator c = new Calculator(); c.add(1, 2); } }
`,
    expectedFunctions: ["add", "main"],
    expectedCalls: ["add"],
    expectedImports: ["java.util.List", "java.util.ArrayList"],
    expectedClasses: ["Calculator", "Main"],
  },
];

describe("Parsing Accuracy per Language", () => {
  beforeAll(async () => {
    await Parser.init();
  });

  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      let rootNode: Node;
      let lang: Language;

      beforeAll(async () => {
        const wasmPath = resolveWasmPath(fixture.config.wasm_file);
        lang = await Language.load(wasmPath);
        const parser = new Parser();
        parser.setLanguage(lang);
        const tree = parser.parse(fixture.source);
        if (!tree) throw new Error(`Failed to parse ${fixture.name} fixture`);
        rootNode = tree.rootNode;
      });

      it(`extracts expected function names`, () => {
        const provider = new DefaultProvider(fixture.config);
        provider.initQueries(lang);
        const names = provider
          .extractFunctions(rootNode)
          .map((n) => resolveCallableName(n));
        for (const expected of fixture.expectedFunctions) {
          expect(names).toContain(expected);
        }
        provider.deleteQueries();
      });

      it(`extracts expected call targets`, () => {
        const provider = new DefaultProvider(fixture.config);
        provider.initQueries(lang);
        const callNodes = provider.extractCalls(rootNode);
        const callNames = callNodes.map((n) => resolveCallableName(n));
        for (const expected of fixture.expectedCalls) {
          expect(callNames).toContain(expected);
        }
        provider.deleteQueries();
      });

      it(`extracts expected class names`, () => {
        const provider = new DefaultProvider(fixture.config);
        provider.initQueries(lang);
        const classNames = provider
          .extractClasses(rootNode)
          .map((n) => n.childForFieldName("name")?.text);
        for (const expected of fixture.expectedClasses ?? []) {
          expect(classNames).toContain(expected);
        }
        provider.deleteQueries();
      });

      if (fixture.expectedImports) {
        it(`extracts expected import paths`, () => {
          const provider = new DefaultProvider(fixture.config);
          provider.initQueries(lang);
          const importNodes = provider.extractImports(rootNode);
          expect(importNodes.length).toBeGreaterThanOrEqual(
            fixture.expectedImports!.length,
          );
          for (const importNode of importNodes) {
            const text = importNode.text;
            const hasMatch = fixture.expectedImports!.some((imp) =>
              text.includes(imp),
            );
            expect(hasMatch).toBe(true);
          }
          provider.deleteQueries();
        });
      }
    });
  }
});
