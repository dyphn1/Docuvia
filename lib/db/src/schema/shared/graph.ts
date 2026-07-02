import { z } from "zod/v4";

export const insertProjectSchema = z.object({
  name: z.string(),
  repoUrl: z.string(),
  description: z.string().nullable().optional(),
  status: z.enum(["active", "indexing", "paused", "error"]).optional(),
  vcsType: z.enum(["git", "svn"]).optional(),
  svnUrl: z.string().nullable().optional(),
  lastGitIngestedAt: z.union([z.string(), z.date()]).nullable().optional(),
  lastSvnRevision: z.number().nullable().optional(),
  lastAstIngestedAt: z.union([z.string(), z.date()]).nullable().optional(),
  ownerId: z.number().optional(),
});
export type InsertProject = z.infer<typeof insertProjectSchema>;

export const insertL1TagSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
});
export type InsertL1Tag = z.infer<typeof insertL1TagSchema>;

export const insertL2NodeSchema = z.object({
  projectId: z.number(),
  name: z.string(),
  type: z.enum(["package", "module", "pcd", "sys-uncategorized"]).optional(),
  isSystem: z.boolean().optional(),
  description: z.string().nullable().optional(),
  aiGenerated: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  pathPatterns: z.any().nullable().optional(),
  reindexRequired: z.boolean().optional(),
  isBootstrapConfirmed: z.boolean().optional(),
  contentHash: z.string().nullable().optional(),
});
export type InsertL2Node = z.infer<typeof insertL2NodeSchema>;

export const insertL3NodeSchema = z.object({
  l2NodeId: z.number(),
  title: z.string(),
  content: z.string().nullable().optional(),
  nodeType: z.enum(["change", "rule", "decision", "context"]).optional(),
  sourceCommits: z.array(z.string()).optional(),
  commitHash: z.string().nullable().optional(),
  aiGenerated: z.boolean().optional(),
  confidence: z.number().nullable().optional(),
  noiseScore: z.number().nullable().optional(),
  occurrenceCount: z.number().optional(),
  introducedInCommit: z.string().nullable().optional(),
  verifiedUntilCommit: z.string().nullable().optional(),
  validityStatus: z.string().optional(),
  source: z.string().optional(),
  contentHash: z.string().nullable().optional(),
});
export type InsertL3Node = z.infer<typeof insertL3NodeSchema>;

export const insertL2NodeL1TagSchema = z.object({
  l2NodeId: z.number(),
  l1TagId: z.number(),
});
export type InsertL2NodeL1Tag = z.infer<typeof insertL2NodeL1TagSchema>;

export const insertNodeLinkSchema = z.object({
  sourceNodeId: z.number(),
  targetNodeId: z.number(),
  linkType: z.string().optional(),
  commitSha: z.string().nullable().optional(),
  diffSummary: z.string().nullable().optional(),
});
export type InsertNodeLink = z.infer<typeof insertNodeLinkSchema>;

export const insertProjectFileSchema = z.object({
  projectId: z.number(),
  filePath: z.string(),
  contentHash: z.string().nullable().optional(),
  lastParsedAt: z.union([z.string(), z.date()]).nullable().optional(),
});
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
