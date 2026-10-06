import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  SemanticCorpusManifest,
  SemanticOracleStatus,
} from "../../lib/contracts/src/index.js";
import { clopperPearsonLowerBound } from "../../lib/core/src/semantic/system1/eval/system1-eval-calibration.js";
import { partitionProofSites } from "./certification-proof-scope.mjs";
import { argsFor, writeJson } from "./run-support.mjs";

const SIGNATURES = [
  "q1:named-import:v1",
  "q2:reexport-trace:v1",
  "q3:super-call:v1",
  "q3:this-inherited:v1",
  "q3:typed-receiver:v1",
  "q3:new-receiver:v1",
  "single-candidate-this-v1",
] as const;

interface PrelabelManifest {
  readonly samples: readonly {
    readonly sampleId: string;
    readonly duplicateGroup: string;
    readonly filePath: string;
    readonly line: number;
    readonly column: number;
    readonly calleeName: string;
  }[];
}

interface ProofSite {
  readonly filePath: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly calleeName: string;
  readonly targetNodeKey: string;
  readonly ruleSignature: string;
}

type SiteOutcome =
  | {
      readonly kind: "success";
      readonly status: "resolved";
      readonly oracleTargets: readonly string[];
    }
  | {
      readonly kind: "contradiction";
      readonly status: "resolved";
      readonly oracleTargets: readonly string[];
    }
  | {
      readonly kind: "multi-location";
      readonly status: "resolved";
      readonly oracleTargets: readonly string[];
    }
  | {
      readonly kind: "timeout";
      readonly status: "timeout";
      readonly oracleTargets: readonly string[];
    }
  | {
      readonly kind: "no-result";
      readonly status: "empty" | "not-ready";
      readonly oracleTargets: readonly string[];
    }
  | {
      readonly kind: "external-or-unsupported";
      readonly status: "unsupported";
      readonly oracleTargets: readonly string[];
    }
  | {
      readonly kind: "error";
      readonly status: "error";
      readonly oracleTargets: readonly string[];
    }
  | {
      readonly kind: "unclassified";
      readonly status: SemanticOracleStatus;
      readonly oracleTargets: readonly string[];
    };

function classify(
  proof: ProofSite,
  oracle: SemanticCorpusManifest["samples"][number]["oracle"],
): SiteOutcome {
  if (oracle.status === "resolved") {
    if (oracle.targetIds.length !== 1)
      return {
        kind: "multi-location",
        status: "resolved",
        oracleTargets: oracle.targetIds,
      };
    return oracle.targetIds[0] === proof.targetNodeKey
      ? { kind: "success", status: "resolved", oracleTargets: oracle.targetIds }
      : {
          kind: "contradiction",
          status: "resolved",
          oracleTargets: oracle.targetIds,
        };
  }
  if (oracle.status === "timeout")
    return {
      kind: "timeout",
      status: "timeout",
      oracleTargets: oracle.targetIds,
    };
  if (oracle.status === "empty" || oracle.status === "not-ready")
    return {
      kind: "no-result",
      status: oracle.status,
      oracleTargets: oracle.targetIds,
    };
  if (oracle.status === "unsupported")
    return {
      kind: "external-or-unsupported",
      status: "unsupported",
      oracleTargets: oracle.targetIds,
    };
  if (oracle.status === "error")
    return { kind: "error", status: "error", oracleTargets: oracle.targetIds };
  return {
    kind: "unclassified",
    status: oracle.status,
    oracleTargets: oracle.targetIds,
  };
}

async function main(): Promise<void> {
  const args = argsFor(process.argv.slice(2), [
    "--track",
    "--prelabel",
    "--labels",
    "--proofs",
    "--out",
  ]);
  const track = args["--track"];
  const prelabel = JSON.parse(
    readFileSync(args["--prelabel"], "utf8"),
  ) as PrelabelManifest;
  const labels = JSON.parse(
    readFileSync(args["--labels"], "utf8"),
  ) as SemanticCorpusManifest;
  const proofs = JSON.parse(
    readFileSync(args["--proofs"], "utf8"),
  ) as readonly ProofSite[];

  const labelById = new Map(
    labels.samples.map((sample) => [sample.sampleId, sample]),
  );
  const scope = partitionProofSites(proofs, prelabel.samples);
  const proofRows = scope.inScope.map(({ proof, sample }) => {
    const labeled = labelById.get(sample.sampleId);
    if (!labeled)
      throw new Error(
        `Oracle label is missing for proven site ${sample.sampleId}`,
      );
    return {
      proof,
      sampleId: sample.sampleId,
      duplicateGroup: sample.duplicateGroup,
      outcome: classify(proof, labeled.oracle),
    };
  });

  const rows = SIGNATURES.map((ruleSignature) => {
    const signatureRows = proofRows.filter(
      (row) => row.proof.ruleSignature === ruleSignature,
    );
    const groups = new Map<string, typeof signatureRows>();
    for (const row of signatureRows) {
      const groupRows = groups.get(row.duplicateGroup) ?? [];
      groupRows.push(row);
      groups.set(row.duplicateGroup, groupRows);
    }
    const groupResults = [...groups.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([duplicateGroup, sites]) => {
        const kinds = sites.map((site) => site.outcome.kind);
        const result = kinds.includes("contradiction")
          ? "contradiction"
          : kinds.every((kind) => kind === "success")
            ? "success"
            : "inconclusive";
        return { duplicateGroup, result, sites };
      });
    const successes = groupResults.filter(
      (group) => group.result === "success",
    ).length;
    const contradictions = groupResults.filter(
      (group) => group.result === "contradiction",
    ).length;
    const trials = groupResults.length;
    const lowerBound =
      trials === 0 ? 0 : clopperPearsonLowerBound(successes, trials);
    const statusCounts: Record<string, number> = {};
    for (const row of signatureRows)
      statusCounts[row.outcome.kind] =
        (statusCounts[row.outcome.kind] ?? 0) + 1;
    return {
      ruleSignature,
      provenSites: signatureRows.length,
      nGroups: trials,
      successes,
      validContradictions: contradictions,
      inconclusiveGroups: groupResults.filter(
        (group) => group.result === "inconclusive",
      ).length,
      lowerBound95: lowerBound,
      statusCounts,
      groupResults,
      contradictionDetails: signatureRows
        .filter((row) => row.outcome.kind === "contradiction")
        .map((row) => ({
          sampleId: row.sampleId,
          duplicateGroup: row.duplicateGroup,
          filePath: row.proof.filePath,
          line: row.proof.startLine,
          column: row.proof.startColumn,
          calleeName: row.proof.calleeName,
          provenTarget: row.proof.targetNodeKey,
          oracleTargets: row.outcome.oracleTargets,
        })),
    };
  });
  const result = {
    schemaVersion: 1,
    track,
    prelabelSamples: prelabel.samples.length,
    oracleLabelSamples: labels.samples.length,
    sourceProofSites: proofs.length,
    proofSitesInFrozenCorpus: proofRows.length,
    proofSitesOutsideFrozenCorpus: scope.outsideScope.length,
    signatures: rows,
  };
  writeJson(path.resolve(args["--out"]), result);
  process.stdout.write(
    `${JSON.stringify({ track, sourceProofSites: proofs.length, proofSitesInFrozenCorpus: proofRows.length, proofSitesOutsideFrozenCorpus: scope.outsideScope.length, signatures: rows.map(({ ruleSignature, nGroups, successes, validContradictions, lowerBound95 }) => ({ ruleSignature, nGroups, successes, validContradictions, lowerBound95 })) })}\n`,
  );
}

await main();
