import {
  QueryService,
  DI_TOKENS,
  DI_KEYS,
  computeImpactRiskLevel,
  appendCommandLogLine,
  IMPACT_LOG_FILE_NAME,
  RiskLevel,
} from "@workspace/core";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

function printBlastRadius(
  blastRadius: Array<{ name: string; type: string }>,
  riskLevel: RiskLevel
): void {
  ui.header(UI_MESSAGES.IMPACT_BLAST_RADIUS_HEADER);

  if (blastRadius.length === 0) {
    ui.warn(UI_MESSAGES.IMPACT_NO_DEPENDENTS);
  } else {
    for (const entry of blastRadius) {
      console.log(`  ${entry.name} (${entry.type})`);
    }
  }

  console.log("");
  const riskLine = `${UI_MESSAGES.IMPACT_RISK_PREFIX}${riskLevel}`;
  if (riskLevel === "CRITICAL") {
    ui.error(riskLine);
  } else if (riskLevel === "HIGH") {
    ui.warn(riskLine);
  } else {
    console.log(riskLine);
  }
  console.log("");
}

export async function impactCommand(
  target: string,
  options: { escalateToLsp?: boolean } = {},
  workspaceRoot: string = process.cwd()
): Promise<void> {
  ui.header(UI_MESSAGES.IMPACT_HEADER);

  if (!target) {
    ui.error(UI_MESSAGES.IMPACT_MISSING_TARGET);
    process.exit(1);
    return;
  }

  const escalateToLsp = options.escalateToLsp;

  const queryService = resolveConfiguredService<QueryService>(DI_TOKENS.QueryService, {
    [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot,
  });

  const spinner = ui.spinner(UI_MESSAGES.IMPACT_START + `"${target}"...`).start();

  await appendCommandLogLine(workspaceRoot, IMPACT_LOG_FILE_NAME, {
    event: "impact.start",
    target,
    escalateToLsp: escalateToLsp ?? false,
  }).catch(() => {});

  let result: Awaited<ReturnType<QueryService["getImpact"]>>;
  try {
    result = await queryService.getImpact(target, escalateToLsp);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(UI_MESSAGES.IMPACT_FAIL + message);
    await appendCommandLogLine(workspaceRoot, IMPACT_LOG_FILE_NAME, {
      event: "impact.error",
      target,
      message,
    }).catch(() => {});
    process.exit(1);
    return;
  }

  if (!result) {
    spinner.warn(UI_MESSAGES.IMPACT_NOT_FOUND + `"${target}"`);
    await appendCommandLogLine(workspaceRoot, IMPACT_LOG_FILE_NAME, {
      event: "impact.summary",
      target,
      found: false,
      blastRadiusCount: 0,
      riskLevel: null,
    }).catch(() => {});
    return;
  }

  spinner.succeed(UI_MESSAGES.IMPACT_SUCCESS + `"${target}"`);
  console.log("");

  const riskLevel = computeImpactRiskLevel(result.blastRadius.length);
  printBlastRadius(result.blastRadius, riskLevel);

  await appendCommandLogLine(workspaceRoot, IMPACT_LOG_FILE_NAME, {
    event: "impact.summary",
    target,
    found: true,
    blastRadiusCount: result.blastRadius.length,
    riskLevel,
  }).catch(() => {});
}
