export const DiagnosticStatus = {
  PASS: "pass",
  FAIL: "fail",
} as const;

export type DiagnosticStatusType =
  (typeof DiagnosticStatus)[keyof typeof DiagnosticStatus];

export interface DiagnosticResult {
  status: DiagnosticStatusType;
  message: string;
  details?: string;
  suggestion?: string;
}

export interface IDiagnosticRunner {
  checkHealth(cwd: string): Promise<Record<string, DiagnosticResult>>;
}
