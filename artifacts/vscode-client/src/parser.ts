import { parse as parseYaml } from "yaml";
import { GlobalConfig, GlobalConfigSchema } from "./types.js";
import { MSG_CONFIG_INVALID, MSG_CONFIG_PARSE_ERROR } from "./constants/index.js";

export function parseGlobalConfig(content: string, filePath: string): GlobalConfig {
  try {
    const raw = parseYaml(content) as unknown;
    const result = GlobalConfigSchema.safeParse(raw);
    if (!result.success) {
      console.error(`${MSG_CONFIG_INVALID}${filePath}:`, result.error.flatten());
      return GlobalConfigSchema.parse({});
    }
    return result.data;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`${MSG_CONFIG_PARSE_ERROR}${filePath}:`, errorMsg);
    return GlobalConfigSchema.parse({});
  }
}
