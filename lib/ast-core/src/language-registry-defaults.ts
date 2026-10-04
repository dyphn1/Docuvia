import {
  LanguageRegistry,
  type LanguageRegistryData,
} from "./language-registry.js";
import { DefaultProvider } from "./language-provider.js";
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

const TSX_EXTENSION = ".tsx";
const TYPESCRIPT_WASM_FILE = "tree-sitter-typescript.wasm";
const TSX_WASM_FILE = "tree-sitter-tsx.wasm";

function ownerOfExtension(
  registryConfig: LanguageRegistryData,
  extension: string,
): string | undefined {
  let owner: string | undefined;
  for (const [language, config] of Object.entries(registryConfig.languages))
    if (config.extensions.includes(extension)) owner = language;
  return owner;
}

/**
 * A TypeScript grammar query is compiled and cached by its provider instance. Share the
 * TypeScript query configuration with TSX, but give it a separate provider so each grammar
 * compiles its own queries. A project language entry that wins `.tsx` registration remains
 * authoritative because only the default shared TypeScript provider is split.
 */
function isolateDefaultTsxProvider(
  registry: LanguageRegistry,
): LanguageRegistry {
  const tsxProvider = registry.getProviderForExtension(TSX_EXTENSION);
  const registryConfig = registry.getConfig();
  const typescriptConfig =
    registryConfig.languages[SUPPORTED_LANGUAGES.TYPESCRIPT];

  if (
    !typescriptConfig ||
    typescriptConfig.wasm_file !== TYPESCRIPT_WASM_FILE ||
    ownerOfExtension(registryConfig, TSX_EXTENSION) !==
      SUPPORTED_LANGUAGES.TYPESCRIPT ||
    !tsxProvider ||
    tsxProvider.wasm_file !== TYPESCRIPT_WASM_FILE
  )
    return registry;

  registry.registerProvider(
    [TSX_EXTENSION],
    new DefaultProvider({
      ...typescriptConfig,
      extensions: [TSX_EXTENSION],
      wasm_file: TSX_WASM_FILE,
    }),
  );
  return registry;
}

export async function loadDefaultRegistry(
  projectRoot?: string,
): Promise<LanguageRegistry> {
  return isolateDefaultTsxProvider(
    await LanguageRegistry.load(projectRoot, DEFAULT_REGISTRY),
  );
}

export function loadDefaultRegistryFromString(
  tomlContent?: string,
): LanguageRegistry {
  return isolateDefaultTsxProvider(
    LanguageRegistry.loadFromString(tomlContent, DEFAULT_REGISTRY),
  );
}
