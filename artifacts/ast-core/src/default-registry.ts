import { LanguageConfig } from "./language-provider.js";
import { SUPPORTED_LANGUAGES } from "./constants.js";
import {
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  rustConfig,
  goConfig,
  javaConfig,
  cConfig,
  cppConfig,
  rubyConfig,
  phpConfig,
  csharpConfig,
} from "./languages/index.js";

export interface LanguageRegistryData {
  languages: Record<string, LanguageConfig>;
}

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
