/** `ExtractedDecision.nodeType` values — mirrors GitNexus's L3 node-type vocabulary. */
export const DecisionNodeType = {
  CHANGE: "change",
  RULE: "rule",
  DECISION: "decision",
  CONTEXT: "context",
} as const;
export type DecisionNodeType =
  (typeof DecisionNodeType)[keyof typeof DecisionNodeType];

export interface ExtractedDecision {
  title: string;
  nodeType: DecisionNodeType;
  content: string;
  confidence: number;
}

/** `AnalyzeResult.kind` discriminant values. */
export const AnalyzeResultKind = {
  CONFIG_SCAN: "configScan",
  DECISION_EXTRACTION: "decisionExtraction",
} as const;

export type AnalyzeResult =
  | {
      kind: typeof AnalyzeResultKind.CONFIG_SCAN;
      projectType: string;
      suggestedTags: string[];
    }
  | {
      kind: typeof AnalyzeResultKind.DECISION_EXTRACTION;
      targetPath: string;
      decisions: ExtractedDecision[];
    };
