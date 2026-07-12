import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  RiskLevels,
  type BlastRadiusEntry,
  type RiskLevel,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

function printBlastRadius(
  blastRadius: BlastRadiusEntry[],
  riskLevel: RiskLevel,
): void {
  ui.header(UI_MESSAGES.IMPACT_BLAST_RADIUS_HEADER);

  if (blastRadius.length === 0) {
    ui.warn(UI_MESSAGES.IMPACT_NO_DEPENDENTS);
  } else {
    for (const entry of blastRadius) {
      console.log("  " + entry.name + " (" + entry.type + ")");
    }
  }

  console.log("");
  const riskLine = UI_MESSAGES.IMPACT_RISK_PREFIX + riskLevel;
  if (riskLevel === RiskLevels.CRITICAL) {
    ui.error(riskLine);
  } else if (riskLevel === RiskLevels.HIGH) {
    ui.warn(riskLine);
  } else {
    console.log(riskLine);
  }
  console.log("");
}

/**
 * Thin caller of docuviaApi.impact() - mirrors init.ts's Presentation-layer responsibilities.
 * escalateToLsp is accepted but treated as a documented no-op (see ImpactWorkflow's doc comment).
 */
export async function impactCommand(
  target: string,
  options: { escalateToLsp?: boolean } = {},
  cwd: string = process.cwd(),
): Promise<void> {
  ui.header(UI_MESSAGES.IMPACT_HEADER);

  if (!target) {
    ui.error(UI_MESSAGES.IMPACT_MISSING_TARGET);
    process.exitCode = 1;
    return;
  }

  const spinner = ui
    .spinner(UI_MESSAGES.IMPACT_START + '"' + target + '"...')
    .start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === "info") spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, "workspaceRoot", cwd);
  docuviaMemory.set(scopeId, "target", target);
  if (options.escalateToLsp) docuviaMemory.set(scopeId, "escalateToLsp", true);

  try {
    const result = await docuviaApi.impact(scopeId, logger);

    if (!result) {
      spinner.warn(UI_MESSAGES.IMPACT_NOT_FOUND + '"' + target + '"');
      return;
    }

    spinner.succeed(UI_MESSAGES.IMPACT_SUCCESS + '"' + target + '"');
    console.log("");
    printBlastRadius(result.blastRadius, result.riskLevel);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.IMPACT_FAIL + message);
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
