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
      /** Count of `decisions` newly written to `l3_nodes` (a fresh content_hash). */
      persisted: number;
      /** Count of `decisions` that matched an existing `l3_nodes` row by content_hash and were
       *  merged into it (occurrence bump) rather than inserted as a duplicate. */
      deduped: number;
    };
