import {
  LanguageRegistry,
  type LanguageRegistryData,
} from "./language-registry.js";
import { SUPPORTED_LANGUAGES } from "./constants.js";
import { typescriptConfig } from "./languages/typescript.js";
import { javascriptConfig } from "./languages/javascript.js";
import { pythonConfig } from "./languages/python.js";
import { rustConfig } from "./languages/rust.js";
import { goConfig } from "./languages/go.js";
import { javaConfig } from "./languages/java.js";
import { cConfig } from "./languages/c.js";
import { cppConfig } from "./languages/cpp.js";
import { rubyConfig } from "./languages/ruby.js";
import { phpConfig } from "./languages/php.js";
import { csharpConfig } from "./languages/csharp.js";

export const DEFAULT_REGISTRY: LanguageRegistryData = {
  languages: {
    [SUPPORTED_LANGUAGES.TYPESCRIPT]: typescriptConfig,
    [SUPPORTED_LANGUAGES.JAVASCRIPT]: javascriptConfig,
    [SUPPORTED_LANGUAGES.PYTHON]: pythonConfig,
    [SUPPORTED_LANGUAGES.RUST]: rustConfig,
    [SUPPORTED_LANGUAGES.GO]: goConfig,
    [SUPPORTED_LANGUAGES.JAVA]: javaConfig,
    [SUPPORTED_LANGUAGES.C]: cConfig,
    [SUPPORTED_LANGUAGES.CPP]: cppConfig,
    [SUPPORTED_LANGUAGES.RUBY]: rubyConfig,
    [SUPPORTED_LANGUAGES.PHP]: phpConfig,
    [SUPPORTED_LANGUAGES.CSHARP]: csharpConfig,
  },
};

export async function loadDefaultRegistry(
  projectRoot?: string,
): Promise<LanguageRegistry> {
  return LanguageRegistry.load(projectRoot, DEFAULT_REGISTRY);
}

export function loadDefaultRegistryFromString(
  tomlContent?: string,
): LanguageRegistry {
  return LanguageRegistry.loadFromString(tomlContent, DEFAULT_REGISTRY);
}
