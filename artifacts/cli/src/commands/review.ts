import { ChangeDetectionService } from "@workspace/core";
import process from "process";

export async function reviewCommand(baseRef?: string) {
  try {
    console.log(`Analyzing changes${baseRef ? ` against ${baseRef}` : ""}...`);
    const changeDetectionService = new ChangeDetectionService(process.cwd());
    const result = await changeDetectionService.detectChanges(baseRef);
    console.log(result.analysis);
  } catch (error: any) {
    console.error("Change detection failed:", error.message);
    process.exit(1);
  }
}
