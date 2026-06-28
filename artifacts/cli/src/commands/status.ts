import { StatusService } from "@workspace/core";
import process from "process";

export async function statusCommand() {
  try {
    const statusService = new StatusService(process.cwd());
    const status = await statusService.getStatus();
    console.log("=== Docuvia Index Status ===");
    console.log(`Projects: ${status.projects}`);
    console.log(`L2 Nodes: ${status.l2Nodes}`);
    console.log(`L3 Decisions: ${status.l3Nodes}`);
  } catch (error: any) {
    console.error("Status check failed:", error.message);
    process.exit(1);
  }
}
