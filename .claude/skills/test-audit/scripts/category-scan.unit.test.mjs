import test from "node:test";
import assert from "node:assert/strict";
import {
  categoriesInSource,
  classifyTier,
  scanEntries,
} from "./category-scan.mjs";

test("classifies persistence, workflow, and utility tiers", () => {
  assert.equal(classifyTier("lib/core/foo.integration.test.ts"), "persistence");
  assert.equal(
    classifyTier("lib/ui-core/src/workflows/query/query-workflow.unit.test.ts"),
    "workflow",
  );
  assert.equal(classifyTier("lib/core/foo.unit.test.ts"), "utility");
});

test("extracts only explicit category markers in canonical order", () => {
  assert.deepEqual(
    categoriesInSource(
      'it("[state-diff] persists", () => {}); it("[happy] works", () => {});',
    ),
    ["happy", "state-diff"],
  );
});

test("requires all five categories for persistence tests", () => {
  const report = scanEntries([
    {
      file: "lib/core/foo.integration.test.ts",
      source: "[happy] [invalid-input] [error-handling] [stress] [state-diff]",
    },
  ]);
  assert.equal(report.failCount, 0);
  assert.equal(report.files[0].score, "5/5");
  assert.deepEqual(report.files[0].missingRequired, []);
});

test("workflow tier treats stress as optional but requires state-diff", () => {
  const report = scanEntries([
    {
      file: "lib/ui-core/src/workflows/demo/demo-workflow.unit.test.ts",
      source: "[happy] [invalid-input] [error-handling] [state-diff]",
    },
  ]);
  assert.equal(report.failCount, 0);
  assert.equal(report.files[0].score, "4/5");
});

test("reports deterministic failures and missing categories", () => {
  const report = scanEntries([
    { file: "z.unit.test.ts", source: "[happy]" },
    { file: "a.unit.test.ts", source: "[happy] [invalid-input]" },
  ]);
  assert.equal(report.failCount, 2);
  assert.deepEqual(
    report.files.map((item) => item.file),
    ["a.unit.test.ts", "z.unit.test.ts"],
  );
  assert.deepEqual(report.files[0].missingRequired, ["error-handling"]);
  assert.deepEqual(report.files[1].missingRequired, [
    "invalid-input",
    "error-handling",
  ]);
});
