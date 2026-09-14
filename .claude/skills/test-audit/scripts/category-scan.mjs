#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const CATEGORIES = [
  "happy",
  "invalid-input",
  "error-handling",
  "stress",
  "state-diff",
];

export const TIER_REQUIREMENTS = {
  persistence: [...CATEGORIES],
  workflow: ["happy", "invalid-input", "error-handling", "state-diff"],
  utility: ["happy", "invalid-input", "error-handling"],
};

const TEST_FILE_PATTERN = /(?:^|\/).+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const CATEGORY_PATTERN = /\[(happy|invalid-input|error-handling|stress|state-diff)\]/gi;

function normalize(file) {
  return file.replaceAll("\\", "/");
}

export function classifyTier(filePath) {
  const file = normalize(filePath).toLowerCase();
  if (/\.integration\.(?:test|spec)\./.test(file)) return "persistence";
  if (file.includes("/workflows/") || /workflow[^/]*\.(?:test|spec)\./.test(file)) {
    return "workflow";
  }
  return "utility";
}

export function categoriesInSource(source) {
  const found = new Set();
  for (const match of source.matchAll(CATEGORY_PATTERN)) {
    found.add(match[1].toLowerCase());
  }
  return CATEGORIES.filter((category) => found.has(category));
}

export function scanEntries(entries, ref = "working-tree") {
  const files = entries
    .filter(({ file }) => TEST_FILE_PATTERN.test(normalize(file)))
    .map(({ file, source }) => {
      const normalizedFile = normalize(file);
      const tier = classifyTier(normalizedFile);
      const observed = categoriesInSource(source);
      const required = TIER_REQUIREMENTS[tier];
      const missingRequired = required.filter((category) => !observed.includes(category));
      return {
        file: normalizedFile,
        tier,
        observed,
        required,
        missingRequired,
        score: `${observed.length}/5`,
        pass: missingRequired.length === 0,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));

  const byTier = {};
  for (const tier of Object.keys(TIER_REQUIREMENTS)) {
    const tierFiles = files.filter((item) => item.tier === tier);
    byTier[tier] = {
      files: tierFiles.length,
      pass: tierFiles.filter((item) => item.pass).length,
      fail: tierFiles.filter((item) => !item.pass).length,
    };
  }

  return {
    schemaVersion: 1,
    ref,
    filesScanned: files.length,
    passCount: files.filter((item) => item.pass).length,
    failCount: files.filter((item) => !item.pass).length,
    missingRequiredTotal: files.reduce(
      (total, item) => total + item.missingRequired.length,
      0,
    ),
    byTier,
    files,
  };
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listFiles(root, ref) {
  const output = ref
    ? git(root, ["ls-tree", "-r", "--name-only", ref])
    : git(root, ["ls-files"]);
  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => TEST_FILE_PATTERN.test(normalize(file)))
    .sort((a, b) => a.localeCompare(b));
}

function readAt(root, file, ref) {
  if (ref) return git(root, ["show", `${ref}:${file}`]);
  return fs.readFileSync(path.join(root, file), "utf8");
}

export function scanRepository(root, ref) {
  const entries = listFiles(root, ref).map((file) => ({
    file,
    source: readAt(root, file, ref),
  }));
  return scanEntries(entries, ref ?? "working-tree");
}

export function formatReport(report) {
  const lines = [
    "TEST CATEGORY COVERAGE",
    `Ref: ${report.ref}`,
    `Files scanned: ${report.filesScanned}`,
    `Pass: ${report.passCount}`,
    `Fail: ${report.failCount}`,
    `Missing required categories: ${report.missingRequiredTotal}`,
  ];

  for (const [tier, summary] of Object.entries(report.byTier)) {
    lines.push(
      `Tier ${tier}: ${summary.pass}/${summary.files} pass (${summary.fail} fail)`,
    );
  }

  lines.push("");
  for (const item of report.files) {
    const status = item.pass ? "PASS" : "FAIL";
    const missing = item.missingRequired.length
      ? ` missing=[${item.missingRequired.join(",")}]`
      : "";
    lines.push(`${status} ${item.score} ${item.tier} ${item.file}${missing}`);
  }
  lines.push("", `FAIL_COUNT=${report.failCount}`);
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { root: process.cwd(), ref: undefined, jsonOut: undefined };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--root") args.root = path.resolve(argv[++i]);
    else if (value === "--ref") args.ref = argv[++i];
    else if (value === "--json-out") args.jsonOut = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = scanRepository(args.root, args.ref);
  if (args.jsonOut) {
    fs.mkdirSync(path.dirname(args.jsonOut), { recursive: true });
    fs.writeFileSync(args.jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(formatReport(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
