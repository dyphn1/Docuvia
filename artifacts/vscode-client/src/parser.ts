import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import {
  GlobalConfig,
  GlobalConfigSchema,
  L1Tag,
  L1TagSchema,
  L2Module,
  L2ModuleSchema,
  L3Decision,
  L3DecisionFrontmatterSchema,
  L3RouterEntry,
  L3RouterEntrySchema,
} from './types.js';

export function parseTags(content: string, filePath: string): L1Tag[] {
  const raw = parseYaml(content) as unknown[];
  return (raw ?? []).map((item, i) => {
    const result = L1TagSchema.safeParse(item);
    if (!result.success) {
      console.error(`[Docuvia] Invalid L1 tag at index ${i} in ${filePath}:`, result.error.flatten());
      return null;
    }
    return result.data;
  }).filter((item): item is L1Tag => item !== null);
}

export function parseModules(content: string, filePath: string): L2Module[] {
  const raw = parseYaml(content) as unknown[];
  return (raw ?? []).map((item, i) => {
    const result = L2ModuleSchema.safeParse(item);
    if (!result.success) {
      console.error(`[Docuvia] Invalid L2 module at index ${i} in ${filePath}:`, result.error.flatten());
      return null;
    }
    return result.data;
  }).filter((item): item is L2Module => item !== null);
}

export function parseRouter(content: string, filePath: string): L3RouterEntry[] {
  const raw = parseYaml(content) as unknown[];
  return (raw ?? []).map((item, i) => {
    const result = L3RouterEntrySchema.safeParse(item);
    if (!result.success) {
      console.error(`[Docuvia] Invalid L3 router entry at index ${i} in ${filePath}:`, result.error.flatten());
      return null;
    }
    return result.data;
  }).filter((item): item is L3RouterEntry => item !== null);
}

export function parseDecision(content: string, mdFilePath: string): L3Decision | null {
  const { data: frontmatter, content: body } = matter(content);

  const result = L3DecisionFrontmatterSchema.safeParse(frontmatter);
  if (!result.success) {
    console.error(`[Docuvia] Invalid L3 decision frontmatter in ${mdFilePath}:`, result.error.flatten());
    return null;
  }

  return {
    ...result.data,
    body: body.trim(),
    filePath: mdFilePath,
  };
}

export function parseGlobalConfig(content: string, filePath: string): GlobalConfig {
  try {
    const raw = parseYaml(content) as unknown;
    const result = GlobalConfigSchema.safeParse(raw);
    if (!result.success) {
      console.error(`[Docuvia] Invalid global config at ${filePath}:`, result.error.flatten());
      return GlobalConfigSchema.parse({});
    }
    return result.data;
  } catch {
    return GlobalConfigSchema.parse({});
  }
}
