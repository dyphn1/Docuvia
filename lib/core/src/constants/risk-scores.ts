export const RiskScore = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
} as const;

export type RiskScoreType = (typeof RiskScore)[keyof typeof RiskScore];

export const FileRiskExtensions = {
  HIGH: [".ts", ".js", ".json"],
  MEDIUM: [".css", ".html"],
} as const;
