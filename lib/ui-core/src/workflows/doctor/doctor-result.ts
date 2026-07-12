import type { DiagnosticResult } from "@workspace/contracts";

export interface DoctorResult {
  allPassed: boolean;
  diagnostics: Record<string, DiagnosticResult>;
}
