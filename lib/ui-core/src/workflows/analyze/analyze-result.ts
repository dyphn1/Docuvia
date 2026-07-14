export interface ExtractedDecision {
  title: string;
  nodeType: "change" | "rule" | "decision" | "context";
  content: string;
  confidence: number;
}

export type AnalyzeResult =
  | { kind: "configScan"; projectType: string; suggestedTags: string[] }
  | {
      kind: "decisionExtraction";
      targetPath: string;
      decisions: ExtractedDecision[];
    };
