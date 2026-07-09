import { z } from "zod";

// ─── L1 Tag ───────────────────────────────────────────────────────────────────

export const L1TagSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

export type L1Tag = z.infer<typeof L1TagSchema>;

// ─── L2 Module ────────────────────────────────────────────────────────────────

export const L2ModuleSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  l1_tag_id: z.string().min(1),
  source_paths: z.array(z.string()).default([]),
});

export type L2Module = z.infer<typeof L2ModuleSchema>;

// ─── L3 Router Entry ─────────────────────────────────────────────────────────
// The lightweight index that maps L3 IDs to their markdown file paths.

export const L3RouterEntrySchema = z.object({
  id: z.string().min(1),
  l2_module_id: z.string(),
  slug: z.string().min(1),
  title: z.string().min(1),
  file_path: z.string().min(1),
});

export type L3RouterEntry = z.infer<typeof L3RouterEntrySchema>;

// ─── L3 Decision (full, from Markdown frontmatter) ───────────────────────────

export const L3DecisionFrontmatterSchema = z.object({
  id: z.string().min(1),
  l2_module_id: z.string(),
  title: z.string().min(1),
  date: z.string().optional(),
  status: z.enum(["proposed", "accepted", "deprecated"]).default("proposed"),
});

export type L3DecisionFrontmatter = z.infer<typeof L3DecisionFrontmatterSchema>;

export interface L3Decision extends L3DecisionFrontmatter {
  /** The Markdown body (excluding frontmatter) */
  body: string;
  /** Absolute path to the .md file on disk */
  filePath: string;
}

// ─── Global Config (~/.docuvia/config.yaml) ───────────────────────────────────

export const GlobalConfigSchema = z.object({
  server_url: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://"), {
      message: "server_url must use HTTPS",
    })
    .optional(),
  chunking_strategy: z.enum(["line", "ast"]).default("line"),
  telemetry: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

// ─── API Snapshot (from server's ProjectGraph endpoint) ───────────────────────

export interface ApiL1Tag {
  id: number;
  name: string;
  category: string;
  description?: string | null;
}

export interface ApiL2Node {
  id: number;
  projectId: number;
  name: string;
  type: string;
  description?: string | null;
  l1TagIds: number[];
}

export interface ApiL3Node {
  id: number;
  l2NodeId: number;
  title: string;
  content?: string | null;
  nodeType: string;
}

export interface ApiNodeLink {
  id: number;
  sourceNodeId: number;
  targetNodeId: number;
  linkType: string;
}

export interface KnowledgeSnapshot {
  projectId: number;
  l1Tags: ApiL1Tag[];
  l2Nodes: ApiL2Node[];
  l3Nodes: ApiL3Node[];
  nodeLinks: ApiNodeLink[];
}

// ─── L1 Template & Project Types ──────────────────────────────────────────────

export enum ProjectType {
  Frontend = "frontend",
  Backend = "backend",
  Fullstack = "fullstack",
  Monorepo = "monorepo",
  Library = "library",
  Cli = "cli",
}

export interface L1TemplateTag {
  slug: string;
  name: string;
  description: string;
}

export interface L1Template {
  projectType: ProjectType;
  label: string;
  /** Keywords searched in README.md text (lowercased) and package.json dependency names */
  keywords: string[];
  tags: L1TemplateTag[];
}
