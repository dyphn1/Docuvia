import fg from "fast-glob";
import path from "path";
import fs from "fs/promises";
import type { IConfigScanner, ILogger } from "@workspace/contracts";
import { createNoopLogger, UTF8_ENCODING } from "@workspace/contracts";
import {
  ConfigTags,
  ProjectTypes,
  GENERAL_TAG,
  DISCOVERY_MESSAGES,
  COMMON_GLOB_IGNORE_PATTERNS,
  ConfigDetectionTags,
  ConfigRuleIds,
  ConfigFilenames,
  ConfigFilePrefixes,
} from "./discovery-constants.js";

export interface ConfigDetectionResult {
  tags: string[];
  projectType?: string;
}

export interface ConfigDetectionRule {
  id: string;
  matchesFile(basename: string): boolean;
  detect(content: string): ConfigDetectionResult | null;
}

function exact(name: string): (basename: string) => boolean {
  return (basename) => basename === name;
}

function prefix(name: string): (basename: string) => boolean {
  return (basename) => basename.startsWith(name);
}

function includesRule(
  id: string,
  matchesFile: (basename: string) => boolean,
  marker: string,
  tags: string[],
): ConfigDetectionRule {
  return {
    id,
    matchesFile,
    detect: (content) => (content.includes(marker) ? { tags } : null),
  };
}

function presenceRule(
  id: string,
  matchesFile: (basename: string) => boolean,
  result: ConfigDetectionResult,
): ConfigDetectionRule {
  return { id, matchesFile, detect: () => result };
}

const isPackageJson = exact(ConfigFilenames.PACKAGE_JSON);
const isCargoToml = exact(ConfigFilenames.CARGO_TOML);
const isPythonMarker = (basename: string) =>
  basename === ConfigFilenames.PYPROJECT_TOML ||
  basename === ConfigFilenames.REQUIREMENTS_TXT;
const isGoMod = exact(ConfigFilenames.GO_MOD);
const isTsconfig = exact(ConfigFilenames.TSCONFIG_JSON);

export const CONFIG_DETECTION_RULES: ConfigDetectionRule[] = [
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_TYPESCRIPT,
    isPackageJson,
    '"typescript"',
    [ConfigTags.TYPESCRIPT],
  ),
  includesRule(ConfigRuleIds.PACKAGE_JSON_REACT, isPackageJson, '"react"', [
    ConfigTags.REACT,
    ConfigDetectionTags.FRONTEND,
  ]),
  includesRule(ConfigRuleIds.PACKAGE_JSON_VUE, isPackageJson, '"vue"', [
    ConfigTags.VUE,
    ConfigDetectionTags.FRONTEND,
  ]),
  includesRule(ConfigRuleIds.PACKAGE_JSON_NEXT, isPackageJson, '"next"', [
    ConfigDetectionTags.NEXTJS,
    ConfigDetectionTags.FRONTEND,
    ConfigDetectionTags.SSR,
  ]),
  includesRule(ConfigRuleIds.PACKAGE_JSON_EXPRESS, isPackageJson, '"express"', [
    ConfigTags.EXPRESS,
    ConfigDetectionTags.BACKEND,
  ]),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_DRIZZLE_ORM,
    isPackageJson,
    '"drizzle-orm"',
    [ConfigDetectionTags.DRIZZLE, ConfigDetectionTags.DATABASE],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_TAILWINDCSS,
    isPackageJson,
    '"tailwindcss"',
    [ConfigDetectionTags.TAILWINDCSS, ConfigDetectionTags.CSS],
  ),
  includesRule(ConfigRuleIds.PACKAGE_JSON_JEST, isPackageJson, '"jest"', [
    ConfigDetectionTags.JEST,
    ConfigDetectionTags.TESTING,
  ]),
  includesRule(ConfigRuleIds.PACKAGE_JSON_VITEST, isPackageJson, '"vitest"', [
    ConfigDetectionTags.VITEST,
    ConfigDetectionTags.TESTING,
  ]),
  includesRule(ConfigRuleIds.PACKAGE_JSON_PG, isPackageJson, '"pg"', [
    ConfigDetectionTags.POSTGRES,
    ConfigDetectionTags.DATABASE,
  ]),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_WORKSPACES,
    isPackageJson,
    '"workspaces"',
    [ConfigDetectionTags.MONOREPO],
  ),

  presenceRule(ConfigRuleIds.CARGO_BASE, isCargoToml, {
    projectType: ProjectTypes.RUST,
    tags: [ProjectTypes.RUST],
  }),
  includesRule(ConfigRuleIds.CARGO_TOKIO, isCargoToml, "tokio", [
    ConfigDetectionTags.TOKIO,
    ConfigDetectionTags.ASYNC,
  ]),
  includesRule(ConfigRuleIds.CARGO_ACTIX, isCargoToml, "actix", [
    ConfigDetectionTags.ACTIX,
    ConfigDetectionTags.BACKEND,
  ]),
  includesRule(ConfigRuleIds.CARGO_SERDE, isCargoToml, "serde", [
    ConfigDetectionTags.SERDE,
  ]),
  includesRule(ConfigRuleIds.CARGO_TAURI, isCargoToml, "tauri", [
    ConfigDetectionTags.TAURI,
    ConfigDetectionTags.DESKTOP,
  ]),

  presenceRule(ConfigRuleIds.PYTHON_BASE, isPythonMarker, {
    projectType: ProjectTypes.PYTHON,
    tags: [ProjectTypes.PYTHON],
  }),
  includesRule(ConfigRuleIds.PYTHON_DJANGO, isPythonMarker, "django", [
    ConfigDetectionTags.DJANGO,
    ConfigDetectionTags.BACKEND,
  ]),
  includesRule(ConfigRuleIds.PYTHON_FASTAPI, isPythonMarker, "fastapi", [
    ConfigDetectionTags.FASTAPI,
    ConfigDetectionTags.BACKEND,
  ]),
  includesRule(ConfigRuleIds.PYTHON_PANDAS, isPythonMarker, "pandas", [
    ConfigDetectionTags.PANDAS,
    ConfigDetectionTags.DATA,
  ]),

  presenceRule(ConfigRuleIds.GO_BASE, isGoMod, {
    projectType: ProjectTypes.GO,
    tags: [ProjectTypes.GO],
  }),
  includesRule(ConfigRuleIds.GO_GIN, isGoMod, "gin-gonic", [
    ConfigDetectionTags.GIN,
    ConfigDetectionTags.BACKEND,
  ]),

  {
    id: ConfigRuleIds.TSCONFIG_STRICT,
    matchesFile: isTsconfig,
    detect: (content) =>
      /"strict"\s*:\s*true/.test(content)
        ? { tags: [ConfigDetectionTags.STRICT_TS] }
        : null,
  },

  presenceRule(
    ConfigRuleIds.VITE_PRESENCE,
    prefix(ConfigFilePrefixes.VITE_CONFIG),
    { tags: [ConfigDetectionTags.VITE, ConfigDetectionTags.BUILD_TOOL] },
  ),
  presenceRule(
    ConfigRuleIds.DRIZZLE_PRESENCE,
    prefix(ConfigFilePrefixes.DRIZZLE_CONFIG),
    { tags: [ConfigDetectionTags.DRIZZLE, ConfigDetectionTags.DATABASE] },
  ),
  presenceRule(
    ConfigRuleIds.TAURI_PRESENCE,
    prefix(ConfigFilePrefixes.TAURI_CONF),
    { tags: [ConfigDetectionTags.TAURI, ConfigDetectionTags.DESKTOP] },
  ),
];

const CONFIG_GLOB_PATTERNS = [
  `**/${ConfigFilenames.PACKAGE_JSON}`,
  `**/${ConfigFilenames.CARGO_TOML}`,
  `**/${ConfigFilenames.PYPROJECT_TOML}`,
  `**/${ConfigFilenames.REQUIREMENTS_TXT}`,
  `**/${ConfigFilenames.GO_MOD}`,
  `**/${ConfigFilenames.TSCONFIG_JSON}`,
  `**/${ConfigFilePrefixes.VITE_CONFIG}.*`,
  `**/${ConfigFilePrefixes.DRIZZLE_CONFIG}.*`,
  "**/webpack.config.*",
  `**/${ConfigFilePrefixes.TAURI_CONF}.*`,
];

const CONFIG_GLOB_IGNORE = [
  ...COMMON_GLOB_IGNORE_PATTERNS,
  "target/**",
  "venv/**",
  ".venv/**",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/test-data/**",
];

export class ConfigScannerService implements IConfigScanner {
  constructor(private readonly logger: ILogger = createNoopLogger()) {}

  public async scanConfigs(
    workspaceRoot: string,
  ): Promise<{ projectType: string; tags: string[] }> {
    let projectType: string = ProjectTypes.UNKNOWN;
    const suggestedTags = new Set<string>();

    try {
      const configFiles = await fg(CONFIG_GLOB_PATTERNS, {
        cwd: workspaceRoot,
        ignore: CONFIG_GLOB_IGNORE,
        absolute: true,
        deep: 3,
      });

      for (const file of configFiles) {
        const basename = path.basename(file);
        let content: string;
        try {
          content = await fs.readFile(file, UTF8_ENCODING);
        } catch {
          continue;
        }

        for (const rule of CONFIG_DETECTION_RULES) {
          if (!rule.matchesFile(basename)) continue;
          const result = rule.detect(content);
          if (!result) continue;
          if (result.projectType) projectType = result.projectType;
          for (const tag of result.tags) suggestedTags.add(tag);
        }
      }

      if (
        suggestedTags.has(ConfigTags.TYPESCRIPT) ||
        suggestedTags.has(ConfigTags.REACT) ||
        suggestedTags.has(ConfigTags.EXPRESS) ||
        suggestedTags.has(ConfigTags.VUE)
      ) {
        if (projectType === ProjectTypes.UNKNOWN)
          projectType = ProjectTypes.JAVASCRIPT;
      }
    } catch (e: any) {
      this.logger.warn(DISCOVERY_MESSAGES.CONFIG_SCAN_FAILED, {
        error: e?.message ?? String(e),
      });
    }

    if (projectType === ProjectTypes.UNKNOWN) {
      projectType = ProjectTypes.GENERIC;
    }

    if (suggestedTags.size === 0) {
      suggestedTags.add(GENERAL_TAG);
    }

    return { projectType, tags: Array.from(suggestedTags) };
  }
}
