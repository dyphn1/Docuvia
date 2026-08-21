import { parse } from "smol-toml";
import { UTF8_ENCODING } from "@workspace/contracts";
import {
  LanguageProvider,
  LanguageConfig,
  DefaultProvider,
} from "./language-provider.js";

const DEFAULT_LANGUAGES_CONFIG_FILENAME = "languages.toml";

export interface LanguageRegistryData {
  languages: Record<string, LanguageConfig>;
}

/**
 * Validates that a parsed TOML object conforms to the expected LanguageRegistryData
 * structure, rejecting any input that doesn't match the required schema.
 * This prevents prototype pollution or logic bypass from a malicious languages.toml.
 */
function validateLanguageRegistryData(
  parsed: unknown,
): parsed is LanguageRegistryData {
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;
  if (!obj.languages || typeof obj.languages !== "object") return false;

  const languages = obj.languages as Record<string, unknown>;
  for (const [name, entry] of Object.entries(languages)) {
    if (!entry || typeof entry !== "object") return false;
    const lang = entry as Record<string, unknown>;

    // Required string fields
    if (typeof lang.wasm_file !== "string") return false;

    // Required array-of-strings fields
    const requiredArrays = [
      "extensions",
      "imports",
      "classes",
      "functions",
      "calls",
    ] as const;
    for (const field of requiredArrays) {
      const val = lang[field];
      if (!Array.isArray(val) || !val.every((v) => typeof v === "string"))
        return false;
    }

    // Optional array-of-strings fields
    const optionalArrays = ["implements", "extends"] as const;
    for (const field of optionalArrays) {
      const val = lang[field];
      if (val !== undefined && val !== null) {
        if (!Array.isArray(val) || !val.every((v) => typeof v === "string"))
          return false;
      }
    }
  }

  return true;
}

export class LanguageRegistry {
  private config: LanguageRegistryData;
  private extToProviderMap: Map<string, LanguageProvider>;

  public constructor(config?: LanguageRegistryData) {
    this.config = config || { languages: {} };
    this.extToProviderMap = new Map();
    this.buildCache();
  }

  private buildCache() {
    this.extToProviderMap.clear();
    for (const [_, langConfig] of Object.entries(this.config.languages)) {
      const provider = new DefaultProvider(langConfig);
      for (const ext of langConfig.extensions) {
        this.extToProviderMap.set(ext, provider);
      }
    }
  }

  public static loadFromString(
    tomlContent?: string,
    baseConfig?: LanguageRegistryData,
  ): LanguageRegistry {
    const base = baseConfig || { languages: {} };
    if (!tomlContent) {
      return new LanguageRegistry(base);
    }
    try {
      const parsed = parse(tomlContent);
      if (validateLanguageRegistryData(parsed)) {
        const mergedLanguages = { ...base.languages, ...parsed.languages };
        return new LanguageRegistry({ languages: mergedLanguages });
      }
    } catch (err: unknown) {
      // Gracefully fall back to defaults silently on parse errors
    }
    return new LanguageRegistry(base);
  }

  public static async load(
    projectRoot?: string,
    baseConfig?: LanguageRegistryData,
  ): Promise<LanguageRegistry> {
    const base = baseConfig || { languages: {} };
    try {
      const _process =
        typeof globalThis !== "undefined"
          ? (globalThis as any).process
          : undefined;
      if (_process && _process.versions && _process.versions.node) {
        // @ts-ignore
        const fs = await import("fs/promises");
        // @ts-ignore
        const path = await import("path");
        const targetPath = projectRoot
          ? path.resolve(projectRoot, DEFAULT_LANGUAGES_CONFIG_FILENAME)
          : path.resolve(_process.cwd(), DEFAULT_LANGUAGES_CONFIG_FILENAME);
        try {
          await fs.access(targetPath);
          const content = await fs.readFile(targetPath, UTF8_ENCODING);
          return LanguageRegistry.loadFromString(content, base);
        } catch (fileErr: unknown) {
          // Gracefully fall back to defaults if file is not accessible
        }
      }
    } catch (err: unknown) {
      // Gracefully fall back to defaults on loading errors
    }
    return new LanguageRegistry(base);
  }

  public getProviderForExtension(ext: string): LanguageProvider | undefined {
    return this.extToProviderMap.get(ext);
  }

  public registerProvider(
    extensions: string[],
    provider: LanguageProvider,
  ): void {
    for (const ext of extensions) {
      this.extToProviderMap.set(ext, provider);
    }
  }

  public getConfig(): LanguageRegistryData {
    return this.config;
  }
}
