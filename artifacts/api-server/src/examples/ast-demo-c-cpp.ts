/**
 * AST Parsing Demo — C / C++
 *
 * Verifies that tree-sitter-c and tree-sitter-cpp are correctly installed
 * and registered in the language registry. Parses sample C and C++ source
 * strings and extracts imports, classes, functions, and calls.
 */

import path from 'node:path';
import { Parser, Language } from 'web-tree-sitter';
import { LanguageRegistry } from '../lib/ast/language-registry.js';

// ── Sample C source ──────────────────────────────────────────────────────────
const cSource = `
#include <stdio.h>
#include <stdlib.h>
#include "myheader.h"

struct Point {
    int x;
    int y;
};

enum Color { RED, GREEN, BLUE };

union Data {
    int i;
    float f;
};

typedef unsigned int uint32;

int add(int a, int b) {
    return a + b;
}

int main() {
    struct Point p = { 1, 2 };
    int result = add(p.x, p.y);
    printf("Result: %d\\n", result);
    return 0;
}
`;

// ── Sample C++ source ────────────────────────────────────────────────────────
const cppSource = `
#include <iostream>
#include <vector>
#include <string>
#include "myclass.h"

using namespace std;

class Shape {
public:
    virtual double area() const = 0;
    virtual ~Shape() = default;
};

class Circle : public Shape {
    double radius;
public:
    Circle(double r) : radius(r) {}
    double area() const override { return 3.14159 * radius * radius; }
};

struct Point {
    int x;
    int y;
};

enum class Color { Red, Green, Blue };

template<typename T>
T maximum(T a, T b) {
    return a > b ? a : b;
}

int main() {
    Circle c(5.0);
    std::cout << "Area: " << c.area() << std::endl;
    int m = maximum(3, 7);
    return 0;
}
`;

async function demo() {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const wasmBasePath = path.join(
    repoRoot,
    'artifacts',
    'api-server',
    'node_modules',
  );

  const registry = await LanguageRegistry.load();

  // ── Parser.init with wasm location (same pattern as ast-worker.ts) ────────
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const tsSitterDir = path.dirname(require.resolve('web-tree-sitter'));
  const treeSitterWasm = path.join(tsSitterDir, 'web-tree-sitter.wasm');
  await Parser.init({ locateFile: () => treeSitterWasm });

  // ── Parse C ──────────────────────────────────────────────────────────────
  console.log('=== C Parsing ===');

  const cProvider = registry.getProviderForExtension('.c');
  if (!cProvider) {
    console.error('ERROR: No provider registered for .c');
    process.exit(1);
  }

  const cWasmPath = path.join(wasmBasePath, 'tree-sitter-c', 'tree-sitter-c.wasm');
  const cLang = await Language.load(cWasmPath);
  const cParser = new Parser();
  cParser.setLanguage(cLang);
  const cTree = cParser.parse(cSource);
  if (!cTree) throw new Error('C: parse returned null');
  const cRoot = cTree.rootNode;

  const cImports = cProvider.extractImports(cRoot);
  const cClasses = cProvider.extractClasses(cRoot);
  const cFunctions = cProvider.extractFunctions(cRoot);
  const cCalls = cProvider.extractCalls(cRoot);

  console.log(`  imports (preproc_include): ${cImports.length}  (expected 3)`);
  console.log(`  classes (struct/enum/union/typedef): ${cClasses.length}  (expected 4)`);
  console.log(`  functions: ${cFunctions.length}  (expected 2 — add, main)`);
  console.log(`  calls: ${cCalls.length}  (expected 2 — add, printf)`);

  if (cImports.length < 3) throw new Error('C: expected at least 3 #include imports');
  if (cClasses.length < 4) throw new Error('C: expected at least 4 class-like nodes');
  if (cFunctions.length < 2) throw new Error('C: expected at least 2 functions');

  // ── Parse C++ ────────────────────────────────────────────────────────────
  console.log('\n=== C++ Parsing ===');

  const cppProvider = registry.getProviderForExtension('.cpp');
  if (!cppProvider) {
    console.error('ERROR: No provider registered for .cpp');
    process.exit(1);
  }

  const cppWasmPath = path.join(wasmBasePath, 'tree-sitter-cpp', 'tree-sitter-cpp.wasm');
  const cppLang = await Language.load(cppWasmPath);
  const cppParser = new Parser();
  cppParser.setLanguage(cppLang);
  const cppTree = cppParser.parse(cppSource);
  if (!cppTree) throw new Error('C++: parse returned null');
  const cppRoot = cppTree.rootNode;

  const cppImports = cppProvider.extractImports(cppRoot);
  const cppClasses = cppProvider.extractClasses(cppRoot);
  const cppFunctions = cppProvider.extractFunctions(cppRoot);
  const cppCalls = cppProvider.extractCalls(cppRoot);

  console.log(`  imports (preproc_include + using): ${cppImports.length}  (expected 5)`);
  console.log(`  classes (class/struct/enum/union/typedef): ${cppClasses.length}  (expected 4)`);
  console.log(`  functions: ${cppFunctions.length}  (expected 4 — Circle::Circle, Circle::area, maximum, main)`);
  console.log(`  calls: ${cppCalls.length}`);

  if (cppImports.length < 4) throw new Error('C++: expected at least 4 import nodes');
  if (cppClasses.length < 3) throw new Error('C++: expected at least 3 class-like nodes');
  if (cppFunctions.length < 3) throw new Error('C++: expected at least 3 functions');

  console.log('\n✅ C/C++ AST parsing demo complete — all assertions passed.');
}

demo().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
