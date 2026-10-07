import {
  CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type CallResolutionQuarantineClearEvidenceInput,
  type CallResolutionQuarantineListResult,
  type CallSiteRuleQuarantineClearRequest,
  type CallSiteRuleQuarantineClearResult,
  type IGraphStore,
  type ILogger,
} from "@workspace/contracts";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import {
  getTrustedCallResolutionCertificationEvidence,
  loadCallResolutionCertificationArtifact,
  parseExpectedCertificationInputsJson,
} from "./call-resolution-certification.js";

const QUARANTINE_ERRORS = {
  REPOSITORY_UNAVAILABLE:
    "Call-site quarantine storage is unavailable in this graph store",
  PROJECT_UNAVAILABLE:
    "The workspace has no initialized project for call-site quarantine",
  INVALID_CERTIFICATION_INPUTS:
    "Trusted certification inputs are missing or invalid",
  CERTIFICATION_NOT_VALID: (details: string) =>
    `Certification cannot clear this quarantine: ${details}`,
  CONFIGURATION_HASH_MISMATCH:
    "Trusted certification inputs do not match the current rule configuration hash",
} as const;

export class CallResolutionQuarantineWorkflow {
  async list(
    workspaceRoot: string,
    logger: ILogger,
  ): Promise<CallResolutionQuarantineListResult> {
    logger.info("Listing local call-resolution quarantines");
    const store = await openStore(workspaceRoot);
    try {
      const project = store.projects.getFirst();
      const repo = requireQuarantineRepository(store);
      return {
        currentRuleConfigurationSha256:
          CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
        active: project ? repo.getRuleQuarantines(project.id) : [],
        clearAudits: project
          ? repo.getRuleQuarantineClearAudits(project.id)
          : [],
      };
    } finally {
      await store.close();
    }
  }

  async clear(
    workspaceRoot: string,
    logger: ILogger,
    ruleSignature: string,
    evidenceInput: CallResolutionQuarantineClearEvidenceInput,
  ): Promise<CallSiteRuleQuarantineClearResult> {
    if (!ruleSignature || !ruleSignature.trim()) {
      throw invalidInput("Rule signature is required");
    }
    logger.info(`Clearing local call-resolution quarantine ${ruleSignature}`);
    const request = createClearRequest(ruleSignature, evidenceInput);
    const store = await openStore(workspaceRoot);
    try {
      const project = store.projects.getFirst();
      if (!project) {
        throw new DocuviaError(
          ErrorCodes.CALL_RESOLUTION_QUARANTINE_UNAVAILABLE,
          QUARANTINE_ERRORS.PROJECT_UNAVAILABLE,
        );
      }
      return requireQuarantineRepository(store).clearRuleQuarantine(
        project.id,
        ruleSignature,
        request,
      );
    } finally {
      await store.close();
    }
  }
}

function createClearRequest(
  ruleSignature: string,
  evidenceInput: CallResolutionQuarantineClearEvidenceInput,
): CallSiteRuleQuarantineClearRequest {
  if (!evidenceInput || typeof evidenceInput !== "object") {
    throw invalidInput("Clear evidence is required");
  }
  switch (evidenceInput.kind) {
    case "operator":
      return createOperatorClearRequest(evidenceInput);
    case "certification":
      return createCertificationClearRequest(ruleSignature, evidenceInput);
    default:
      throw invalidInput("Unsupported quarantine clear evidence");
  }
}

function createOperatorClearRequest(
  evidenceInput: Extract<
    CallResolutionQuarantineClearEvidenceInput,
    { kind: "operator" }
  >,
): CallSiteRuleQuarantineClearRequest {
  if (!evidenceInput.operator?.trim() || !evidenceInput.reason?.trim()) {
    throw invalidInput("Operator identity and reason are required");
  }
  return {
    newRuleConfigurationSha256: CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
    evidence: {
      kind: "operator",
      operator: evidenceInput.operator,
      reason: evidenceInput.reason,
    },
  };
}

function createCertificationClearRequest(
  ruleSignature: string,
  evidenceInput: Extract<
    CallResolutionQuarantineClearEvidenceInput,
    { kind: "certification" }
  >,
): CallSiteRuleQuarantineClearRequest {
  if (
    typeof evidenceInput.artifact !== "string" ||
    typeof evidenceInput.trustedInputsJson !== "string"
  ) {
    throw invalidInput("Unsupported quarantine clear evidence");
  }

  const expected = parseExpectedCertificationInputsJson(
    evidenceInput.trustedInputsJson,
  );
  if (!expected) {
    throw invalidInput(QUARANTINE_ERRORS.INVALID_CERTIFICATION_INPUTS);
  }
  if (
    expected.ruleConfigurationSha256 !==
    CALL_RESOLUTION_RULE_CONFIGURATION_SHA256
  ) {
    throw invalidInput(QUARANTINE_ERRORS.CONFIGURATION_HASH_MISMATCH);
  }
  const decision = loadCallResolutionCertificationArtifact(
    evidenceInput.artifact,
    expected,
  );
  const trustedEvidence = getTrustedCallResolutionCertificationEvidence(
    decision,
    ruleSignature,
  );
  if (!trustedEvidence) {
    const details =
      decision.rejectionReasons.join("; ") ||
      `signature ${ruleSignature} did not pass both certification tracks`;
    throw invalidInput(QUARANTINE_ERRORS.CERTIFICATION_NOT_VALID(details));
  }
  return {
    newRuleConfigurationSha256: trustedEvidence.ruleConfigurationSha256,
    evidence: {
      kind: "certification",
      evidenceSha256: trustedEvidence.artifactSha256,
      resultsRecordedAt: trustedEvidence.resultsRecordedAt,
    },
  };
}

async function openStore(workspaceRoot: string): Promise<IGraphStore> {
  const openGraphStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
  return openGraphStore({ dbPath: resolveDbPath(workspaceRoot) });
}

function requireQuarantineRepository(store: IGraphStore) {
  const repo = store.callSiteResolutions;
  if (
    !repo ||
    typeof repo.getRuleQuarantines !== "function" ||
    typeof repo.getRuleQuarantineClearAudits !== "function" ||
    typeof repo.clearRuleQuarantine !== "function"
  ) {
    throw new DocuviaError(
      ErrorCodes.CALL_RESOLUTION_QUARANTINE_UNAVAILABLE,
      QUARANTINE_ERRORS.REPOSITORY_UNAVAILABLE,
    );
  }
  return repo;
}

function invalidInput(message: string): DocuviaError {
  return new DocuviaError(ErrorCodes.INVALID_INPUT, message);
}
