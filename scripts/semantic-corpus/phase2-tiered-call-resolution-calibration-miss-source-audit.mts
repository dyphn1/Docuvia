/** Exact pinned-source audit of the sixteen CALIBRATION raw-generation losses. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeAstProcessor } from "./phase2-tiered-call-resolution-source.mjs";
import {
  allFactRows,
  canonicalHash,
  sha256,
  writeJson,
} from "./phase2-tiered-call-resolution-support.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SUMMARY_PATH =
  "docs/gitbook/analysis/tiered-call-resolution-phase2-p2a-calibration-cap-evidence/calibration-cap-summary.json";
const PINS = {
  summary: "afe3d04099ca83ab5330962a638aeb1367cf6e0947f1a5697928653219f1b13f",
  replay: "a54ea61858e9025b53468a94fbe25e7ecb18319913e15e4fbf66463969e33e02",
  facts: "ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e",
  revision: "6a46bb25a132f3bb35da76ef678b99718e37c2f5",
  tsconfig: "235139181c8ebfc0f1f6cb07771d00cabed961d7c41469c9ef6b3cb04f86d6ef",
} as const;

interface MissEvidence {
  readonly parserBinding: string;
  readonly importDescriptorCount: number;
  readonly configuredPathMatchesTarget: boolean;
  readonly directNamedExport: boolean;
  readonly combinedDefaultImportInSource: boolean;
  readonly directDefaultFunctionInSource: boolean;
  readonly parserHasDefaultExport: boolean;
}

export function classifyCalibrationSourceMiss(evidence: MissEvidence) {
  if (!evidence.configuredPathMatchesTarget)
    throw new Error("Classification requires exact pinned source evidence.");
  if (
    evidence.parserBinding === "import" &&
    evidence.importDescriptorCount === 1 &&
    evidence.directNamedExport
  )
    return {
      classification: "configured-path-named-import-gap" as const,
      ordinarySourceCase: true,
      needsTypeInference: false,
    };
  if (
    evidence.parserBinding === "unbound" &&
    evidence.importDescriptorCount === 0 &&
    evidence.combinedDefaultImportInSource &&
    evidence.directDefaultFunctionInSource &&
    !evidence.parserHasDefaultExport
  )
    return {
      classification: "combined-default-import-export-descriptor-gap" as const,
      ordinarySourceCase: true,
      needsTypeInference: false,
    };
  throw new Error("Classification requires exact pinned source evidence.");
}

function pinnedBytes(file: string, expected: string): Buffer {
  const bytes = readFileSync(path.join(ROOT, file));
  if (sha256(bytes) !== expected)
    throw new Error(`Pinned source evidence changed: ${file}.`);
  return bytes;
}

function snapshotBytes(file: string): Buffer {
  if (
    file.startsWith("/") ||
    file.split("/").includes("..") ||
    /[\r\n]/u.test(file)
  )
    throw new Error("Unsafe pinned source path.");
  return execFileSync("git", ["show", `${PINS.revision}:${file}`], {
    cwd: path.resolve(ROOT, "../repomind"),
  });
}

async function run(): Promise<void> {
  if (process.argv.length !== 2)
    throw new Error("This pinned CALIBRATION-only audit accepts no overrides.");
  const summary = JSON.parse(
    pinnedBytes(SUMMARY_PATH, PINS.summary).toString("utf8"),
  );
  if (
    summary.split !== "calibration" ||
    summary.labelSplitsRead.join() !== "calibration" ||
    summary.sampleIdCount !== 2966 ||
    summary.cap25MissingTargets.length !== 16 ||
    !summary.replay.allDecisionFieldsEquivalent ||
    summary.replay.sourcePositionExcludedCount !== 0 ||
    summary.replay.parserFactMissingCount !== 0
  )
    throw new Error(
      "Source audit requires the verified CALIBRATION-only cap summary.",
    );
  const snapshot = summary.replay.snapshots.find(
    (row: { snapshotId: string }) => row.snapshotId === "repomind",
  );
  if (snapshot.revision !== PINS.revision)
    throw new Error("Pinned CALIBRATION revision changed.");
  for (const [file, hash] of Object.entries(
    summary.provenance.replayImplementationFiles,
  ))
    pinnedBytes(file, hash as string);
  const replay = pinnedBytes(summary.replay.evidencePath, PINS.replay)
    .toString("utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  if (
    replay.length !== 2966 ||
    replay.some((row) => row.split !== "calibration")
  )
    throw new Error("CALIBRATION replay population differs.");
  const byId = new Map(replay.map((row) => [row.sampleId, row]));
  pinnedBytes(
    "evaluate/results/semantic-corpus/v1/phase1-baseline-edge-parity-formatted-final/declared-type-facts-pass-a.jsonl",
    PINS.facts,
  );
  const facts = allFactRows().filter(
    (row) => row.snapshotId === "repomind" && row.repoId === snapshot.repoId,
  );
  const sourcePaths = [
    ...new Set(
      summary.cap25MissingTargets.flatMap(
        (row: { source: { filePath: string }; targetId: string }) => [
          row.source.filePath,
          row.targetId.split("#")[0],
        ],
      ),
    ),
  ] as string[];
  const files = sourcePaths.map((file) => {
    const bytes = snapshotBytes(file);
    const fact = facts.find((row) => row.filePath === file);
    if (!fact || sha256(bytes) !== fact.fileContentSha256)
      throw new Error(`Pinned source/facts differ: ${file}.`);
    return { file, hash: sha256(bytes), code: bytes.toString("utf8") };
  });
  const configBytes = snapshotBytes("tsconfig.json");
  if (sha256(configBytes) !== PINS.tsconfig)
    throw new Error("Pinned tsconfig bytes changed.");
  const config = JSON.parse(configBytes.toString("utf8"));
  if (
    canonicalHash(config.compilerOptions.paths) !==
      canonicalHash({ "@/*": ["./src/*"] }) ||
    config.extends !== undefined ||
    config.compilerOptions.baseUrl !== undefined
  )
    throw new Error(
      "Audit expects the explicit single root-local configured path.",
    );
  const temp = mkdtempSync(path.join(tmpdir(), "docuvia-cal-miss-source-"));
  try {
    const processed = await makeAstProcessor().processFiles(temp, files);
    if (
      processed.failures.length !== 0 ||
      processed.parsed.length !== files.length
    )
      throw new Error("Exact pinned source parser failed.");
    const byFile = new Map(processed.parsed.map((row) => [row.file, row.data]));
    const bySource = new Map(files.map((row) => [row.file, row]));
    const cases = summary.cap25MissingTargets.map(
      (miss: {
        sampleId: string;
        source: {
          filePath: string;
          line: number;
          column: number;
          calleeName: string;
        };
        targetId: string;
      }) => {
        const replayRow = byId.get(miss.sampleId);
        if (
          !replayRow ||
          replayRow.generatedCandidateKeys.length !== 0 ||
          replayRow.snapshotId !== "repomind"
        )
          throw new Error("Expected a CALIBRATION raw-zero loss.");
        const caller = bySource.get(miss.source.filePath)!;
        const data = byFile.get(miss.source.filePath)!;
        if (caller.hash !== replayRow.sourceContentHash)
          throw new Error("Pinned caller hash differs from replay.");
        const exact =
          data.callSiteShapeFacts?.callSites.filter(
            (fact) =>
              fact.startLine === miss.source.line &&
              fact.startColumn === miss.source.column &&
              fact.calleeName === miss.source.calleeName,
          ) ?? [];
        if (
          exact.length !== 1 ||
          canonicalHash(exact[0]) !== canonicalHash(replayRow.callSiteFact)
        )
          throw new Error("Exact labeled parser fact differs.");
        const callSiteInputHash = canonicalHash({
          callerFilePath: caller.file,
          callerSourceContentHash: caller.hash,
          callSite: exact[0],
          sourceFingerprint: snapshot.sourceFingerprint,
          configurationHash: summary.configurationHash,
        });
        if (callSiteInputHash !== replayRow.callSiteInputHash)
          throw new Error("Exact callsite input hash differs.");
        const [targetPath, targetName] = miss.targetId.split("#");
        if (
          !targetPath ||
          !targetName ||
          !/^[A-Za-z_$][\w$]*$/u.test(targetName)
        )
          throw new Error("Unsupported target identity in source audit.");
        const target = bySource.get(targetPath)!;
        const targetData = byFile.get(targetPath)!;
        const declarations =
          targetData.declaredTypeFacts?.declarations.filter(
            (declaration) =>
              declaration.name === targetName &&
              declaration.kind === "function" &&
              declaration.owner.kind === "program",
          ) ?? [];
        if (declarations.length !== 1)
          throw new Error("Expected one direct top-level function target.");
        const imports = data.imports.filter(
          (descriptor) => descriptor.localName === miss.source.calleeName,
        );
        const combined = new RegExp(
          `import\\s+${miss.source.calleeName}\\s*,\\s*\\{[^}]*\\}\\s*from\\s*["']([^"']+)["']`,
          "u",
        ).exec(caller.code);
        const modulePath = imports[0]?.modulePath ?? combined?.[1];
        const expectedPath = modulePath?.startsWith("@/")
          ? `src/${modulePath.slice(2)}`
          : null;
        const configuredPathMatchesTarget =
          expectedPath !== null &&
          targetPath.replace(/\.(?:ts|tsx|js|jsx)$/u, "") === expectedPath;
        const directNamedExport =
          imports.length === 1 &&
          !imports[0]?.viaReexport &&
          !imports[0]?.isTypeOnly &&
          imports[0]?.originalName === targetName &&
          targetData.exports.filter(
            (descriptor) => descriptor.name === targetName,
          ).length === 1 &&
          new RegExp(
            `^export\\s+(?:async\\s+)?function\\s+${targetName}\\b`,
            "mu",
          ).test(target.code);
        const directDefaultFunctionInSource = new RegExp(
          `^export\\s+default\\s+(?:async\\s+)?function\\s+${targetName}\\b`,
          "mu",
        ).test(target.code);
        const parserHasDefaultExport = targetData.exports.some(
          (descriptor) =>
            descriptor.name === "default" || descriptor.name === targetName,
        );
        const evidence = {
          parserBinding: exact[0]!.calleeBinding?.kind ?? "none",
          importDescriptorCount: imports.length,
          configuredPathMatchesTarget,
          directNamedExport,
          combinedDefaultImportInSource: combined !== null,
          directDefaultFunctionInSource,
          parserHasDefaultExport,
        };
        const classification = classifyCalibrationSourceMiss(evidence);
        return {
          ...miss,
          ...classification,
          evidence,
          sourceContentHash: caller.hash,
          targetSourceContentHash: target.hash,
          callSiteInputHash,
          exactCallSiteFact: exact[0],
          importDescriptors: imports,
          sourceImportStatement: combined?.[0] ?? null,
          configuredModulePath: modulePath,
          targetDeclaration: declarations[0],
          parserTargetExports: targetData.exports,
          sourceCallLine: caller.code.split(/\r?\n/u)[miss.source.line],
          targetDirectExportLine: target.code
            .split(/\r?\n/u)
            .find(
              (line) =>
                line.startsWith("export ") &&
                line.includes(`function ${targetName}`),
            ),
        };
      },
    );
    const counts = Object.fromEntries(
      [
        ...new Set(
          cases.map((row: { classification: string }) => row.classification),
        ),
      ].map((name) => [
        name,
        cases.filter(
          (row: { classification: string }) => row.classification === name,
        ).length,
      ]),
    );
    if (
      counts["configured-path-named-import-gap"] !== 13 ||
      counts["combined-default-import-export-descriptor-gap"] !== 3
    )
      throw new Error("Bounded source classification population changed.");
    const runnerPath =
      "scripts/semantic-corpus/phase2-tiered-call-resolution-calibration-miss-source-audit.mts";
    const artifact = {
      schemaVersion: 1,
      measurement: "phase2-p2a-calibration-miss-source-audit/1",
      split: "calibration",
      labelSplitsRead: [],
      labelsCopiedFromVerifiedCalibrationSummary: true,
      productionBehaviorChanged: false,
      corpusManifestRead: false,
      systemOneArtifactsRead: false,
      pinnedCalibrationSummary: {
        path: SUMMARY_PATH,
        sha256: PINS.summary,
        calibrationLabelRowsHash: summary.calibrationLabelRowsHash,
        sampleIdCount: summary.sampleIdCount,
        sampleIdsHash: summary.sampleIdsHash,
      },
      source: {
        ...snapshot,
        files: files.map(({ file, hash }) => ({ file, sha256: hash })),
        tsconfigPath: "tsconfig.json",
        tsconfigSha256: PINS.tsconfig,
        compilerOptionsPaths: config.compilerOptions.paths,
        baseUrl: null,
        extends: null,
      },
      parserEvidence: {
        parsedFiles: files.length,
        parseFailures: 0,
        exactCallFacts: cases.length,
        allCallSiteInputHashesMatch: true,
        exactInputsHash: canonicalHash(
          cases.map((row: { sampleId: string; callSiteInputHash: string }) => [
            row.sampleId,
            row.callSiteInputHash,
          ]),
        ),
      },
      classificationCounts: counts,
      cases,
      provenance: {
        pins: PINS,
        runnerPath,
        runnerSha256: sha256(readFileSync(path.join(ROOT, runnerPath))),
        configurationHash: summary.configurationHash,
        replayImplementationHash: summary.provenance.replayImplementationHash,
        replayImplementationFiles: summary.provenance.replayImplementationFiles,
      },
    };
    writeJson(
      path.join(
        ROOT,
        "evaluate/results/semantic-corpus/v1/phase2-p2a-v4-calibration-miss-source-audit/calibration-miss-source-summary.json",
      ),
      artifact,
    );
    process.stdout.write(
      `${JSON.stringify({ classifiedRows: cases.length, counts, parsedFiles: files.length, tsconfigSha256: PINS.tsconfig })}\n`,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await run();
