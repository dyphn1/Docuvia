import { z } from 'zod';

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
  l2_module_id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  file_path: z.string().min(1),
});

export type L3RouterEntry = z.infer<typeof L3RouterEntrySchema>;

// ─── L3 Decision (full, from Markdown frontmatter) ───────────────────────────

export const L3DecisionFrontmatterSchema = z.object({
  id: z.string().min(1),
  l2_module_id: z.string().min(1),
  title: z.string().min(1),
  date: z.string().optional(),
  status: z.enum(['proposed', 'accepted', 'deprecated']).default('proposed'),
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
  server_url: z.string().url().optional(),
  chunking_strategy: z.enum(['line', 'ast']).default('line'),
  telemetry: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
