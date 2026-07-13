import { parse } from "smol-toml";
import {
  LanguageProvider,
  LanguageConfig,
  DefaultProvider,
} from "./language-provider.js";

export interface LanguageRegistryData {
  languages: Record<string, LanguageConfig>;
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
      const parsed = parse(tomlContent) as unknown as LanguageRegistryData;
      if (parsed && typeof parsed === "object" && parsed.languages) {
        const mergedLanguages = { ...base.languages, ...parsed.languages };
        return new LanguageRegistry({ languages: mergedLanguages });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Failed to parse languages.toml:", msg);
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
          ? path.resolve(projectRoot, "languages.toml")
          : path.resolve(_process.cwd(), "languages.toml");
        try {
          await fs.access(targetPath);
          const content = await fs.readFile(targetPath, "utf-8");
          return LanguageRegistry.loadFromString(content, base);
        } catch (fileErr: unknown) {
          if (_process.env?.LOG_LEVEL === "debug") {
            console.debug(
              `[LanguageRegistry] Could not read ${targetPath}, falling back to defaults. Reason:`,
              fileErr instanceof Error ? fileErr.message : String(fileErr),
            );
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Failed to load languages.toml dynamically:", msg);
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
