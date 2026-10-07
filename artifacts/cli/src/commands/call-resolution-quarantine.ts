import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "process";
import {
  docuviaMemory,
  DocuviaError,
  ErrorCodes,
  MemoryKeys,
  type CallResolutionQuarantineClearEvidenceInput,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

const MAX_EVIDENCE_FILE_BYTES = 4 * 1024 * 1024;

export interface CallResolutionQuarantineCommandOptions {
  operator?: string;
  reason?: string;
  artifactPath?: string;
  trustedInputsPath?: string;
}

/** `docuvia call-resolution quarantine list|clear` manages workspace-local runtime state. */
export async function callResolutionQuarantineCommand(
  resource: string | undefined,
  subcommand: string | undefined,
  ruleSignature: string | undefined,
  options: CallResolutionQuarantineCommandOptions,
  cwd: string = process.cwd(),
): Promise<void> {
  if (resource !== "quarantine") {
    ui.error(UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_USAGE);
    process.exitCode = 1;
    return;
  }
  if (subcommand === "list") {
    if (hasClearOptions(options)) {
      ui.error(UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_USAGE);
      process.exitCode = 1;
      return;
    }
    await listQuarantines(cwd);
    return;
  }
  if (subcommand !== "clear") {
    ui.error(
      UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_INVALID_SUBCOMMAND(subcommand),
    );
    process.exitCode = 1;
    return;
  }
  if (!ruleSignature?.trim()) {
    ui.error(UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_USAGE);
    process.exitCode = 1;
    return;
  }

  let evidenceInput: CallResolutionQuarantineClearEvidenceInput | undefined;
  try {
    evidenceInput = await resolveEvidenceInput(cwd, options);
  } catch (error: unknown) {
    ui.error(
      UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_CLEAR_FAIL +
        resolveErrorMessage(error),
    );
    process.exitCode = 1;
    return;
  }
  if (!evidenceInput) return;
  await clearQuarantine(cwd, ruleSignature, evidenceInput);
}

async function listQuarantines(cwd: string): Promise<void> {
  const scopeId = cryptoRandomId();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  try {
    const result = await docuviaApi.listCallResolutionQuarantines(
      scopeId,
      createPinoBackedLogger(),
    );
    ui.header(UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_HEADER);
    ui.info(
      `Current rule configuration SHA-256: ${result.currentRuleConfigurationSha256}`,
    );
    if (result.active.length === 0) {
      ui.info(UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_NONE);
    } else {
      ui.table(
        [
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_SIGNATURE },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_CREATED },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_REASON },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_PREVIOUS_HASH },
        ],
        result.active.map((quarantine) => [
          quarantine.ruleSignature,
          quarantine.createdAt,
          quarantine.reason,
          quarantine.ruleConfigurationSha256 ?? "unknown (legacy)",
        ]),
      );
    }
    if (result.clearAudits.length > 0) {
      ui.header(UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_AUDIT_HEADER);
      ui.table(
        [
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_SIGNATURE },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_CLEARED },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_METHOD },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_EVIDENCE },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_OPERATOR },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_REASON },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_PREVIOUS_HASH },
          { header: UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_COL_NEW_HASH },
        ],
        result.clearAudits.map((audit) => [
          audit.ruleSignature,
          audit.clearedAt,
          audit.method,
          audit.evidenceSha256 ?? "operator attestation",
          audit.operator ?? "—",
          audit.reason ?? "—",
          audit.previousRuleConfigurationSha256,
          audit.newRuleConfigurationSha256,
        ]),
      );
    }
  } catch (error: unknown) {
    ui.error(
      UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_LIST_FAIL +
        resolveErrorMessage(error),
    );
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

async function clearQuarantine(
  cwd: string,
  ruleSignature: string,
  evidenceInput: CallResolutionQuarantineClearEvidenceInput,
): Promise<void> {
  const scopeId = cryptoRandomId();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  try {
    const logger = createPinoBackedLogger();
    const listing = await docuviaApi.listCallResolutionQuarantines(
      scopeId,
      logger,
    );
    const quarantine = listing.active.find(
      (entry) => entry.ruleSignature === ruleSignature,
    );
    const evidenceSha256 =
      evidenceInput.kind === "certification"
        ? createHash("sha256")
            .update(evidenceInput.artifact, "utf8")
            .digest("hex")
        : "operator attestation";

    ui.header(UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_CLEAR_PREVIEW);
    ui.table(
      [{ header: "Field" }, { header: "Value" }],
      [
        ["Rule signature", ruleSignature],
        [
          "Current state",
          quarantine ? "active quarantine" : "no active quarantine",
        ],
        ["Quarantined at", quarantine?.createdAt ?? "—"],
        [
          "Previous config SHA-256",
          quarantine?.ruleConfigurationSha256 ?? "unknown (legacy)",
        ],
        ["New config SHA-256", listing.currentRuleConfigurationSha256],
        ["Clear evidence", evidenceSha256],
        [
          "Operator / reason",
          evidenceInput.kind === "operator"
            ? `${evidenceInput.operator}: ${evidenceInput.reason}`
            : "trusted two-track certification artifact",
        ],
      ],
    );

    const result = await docuviaApi.clearCallResolutionQuarantine(
      scopeId,
      logger,
      ruleSignature,
      evidenceInput,
    );
    if (result.status === "already-cleared") {
      ui.info(UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_ALREADY_CLEARED);
      return;
    }
    ui.success(
      UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_CLEAR_SUCCESS(ruleSignature),
    );
  } catch (error: unknown) {
    ui.error(
      UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_CLEAR_FAIL +
        resolveErrorMessage(error),
    );
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

async function resolveEvidenceInput(
  cwd: string,
  options: CallResolutionQuarantineCommandOptions,
): Promise<CallResolutionQuarantineClearEvidenceInput | undefined> {
  const evidenceMode = getClearEvidenceMode(options);
  if (!evidenceMode) {
    ui.error(
      hasAnyClearEvidenceOption(options)
        ? UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_EVIDENCE_EXCLUSIVE
        : UI_MESSAGES.CALL_RESOLUTION_QUARANTINE_EVIDENCE_REQUIRED,
    );
    process.exitCode = 1;
    return undefined;
  }
  if (evidenceMode === "operator") {
    return createOperatorEvidenceInput(options);
  }
  return readCertificationEvidenceInput(cwd, options);
}

function getClearEvidenceMode(
  options: CallResolutionQuarantineCommandOptions,
): "operator" | "certification" | undefined {
  if (isOperatorEvidenceMode(options)) return "operator";
  if (isCertificationEvidenceMode(options)) return "certification";
  return undefined;
}

function isOperatorEvidenceMode(
  options: CallResolutionQuarantineCommandOptions,
): boolean {
  if (!options.operator?.trim() || !options.reason?.trim()) return false;
  return !options.artifactPath?.trim() && !options.trustedInputsPath?.trim();
}

function isCertificationEvidenceMode(
  options: CallResolutionQuarantineCommandOptions,
): boolean {
  if (!options.artifactPath?.trim() || !options.trustedInputsPath?.trim()) {
    return false;
  }
  return !options.operator?.trim() && !options.reason?.trim();
}

function hasAnyClearEvidenceOption(
  options: CallResolutionQuarantineCommandOptions,
): boolean {
  return Boolean(
    options.operator ||
    options.reason ||
    options.artifactPath ||
    options.trustedInputsPath,
  );
}

function createOperatorEvidenceInput(
  options: CallResolutionQuarantineCommandOptions,
): CallResolutionQuarantineClearEvidenceInput {
  return {
    kind: "operator",
    operator: options.operator!.trim(),
    reason: options.reason!.trim(),
  };
}

async function readCertificationEvidenceInput(
  cwd: string,
  options: CallResolutionQuarantineCommandOptions,
): Promise<CallResolutionQuarantineClearEvidenceInput> {
  const [artifact, trustedInputsJson] = await Promise.all([
    readEvidenceFile(cwd, options.artifactPath!),
    readEvidenceFile(cwd, options.trustedInputsPath!),
  ]);
  return { kind: "certification", artifact, trustedInputsJson };
}

function hasClearOptions(
  options: CallResolutionQuarantineCommandOptions,
): boolean {
  return Boolean(
    options.operator ||
    options.reason ||
    options.artifactPath ||
    options.trustedInputsPath,
  );
}

async function readEvidenceFile(
  cwd: string,
  filePath: string,
): Promise<string> {
  const workspaceRoot = await fs.realpath(cwd);
  const resolvedPath = path.resolve(workspaceRoot, filePath);
  const actualPath = await fs.realpath(resolvedPath);
  const relativePath = path.relative(workspaceRoot, actualPath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new DocuviaError(
      ErrorCodes.INVALID_INPUT,
      "Certification evidence files must be inside the workspace",
    );
  }
  const stat = await fs.stat(actualPath);
  if (!stat.isFile() || stat.size > MAX_EVIDENCE_FILE_BYTES) {
    throw new DocuviaError(
      ErrorCodes.INVALID_INPUT,
      `Certification evidence files must be regular files no larger than ${MAX_EVIDENCE_FILE_BYTES} bytes`,
    );
  }
  return fs.readFile(actualPath, "utf8");
}

function cryptoRandomId(): string {
  return randomUUID();
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof DocuviaError || error instanceof Error
    ? error.message
    : String(error);
}
