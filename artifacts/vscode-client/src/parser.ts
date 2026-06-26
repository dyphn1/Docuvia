import { parse as parseYaml } from "yaml";
import {
  GlobalConfig,
  GlobalConfigSchema,
} from "./types.js";

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
