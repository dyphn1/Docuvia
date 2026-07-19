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
  ConfigMarkers,
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
    ConfigMarkers.PACKAGE_JSON_TYPESCRIPT,
    [ConfigTags.TYPESCRIPT],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_REACT,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_REACT,
    [ConfigTags.REACT, ConfigDetectionTags.FRONTEND],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_VUE,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_VUE,
    [ConfigTags.VUE, ConfigDetectionTags.FRONTEND],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_NEXT,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_NEXT,
    [
      ConfigDetectionTags.NEXTJS,
      ConfigDetectionTags.FRONTEND,
      ConfigDetectionTags.SSR,
    ],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_EXPRESS,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_EXPRESS,
    [ConfigTags.EXPRESS, ConfigDetectionTags.BACKEND],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_DRIZZLE_ORM,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_DRIZZLE_ORM,
    [ConfigDetectionTags.DRIZZLE, ConfigDetectionTags.DATABASE],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_TAILWINDCSS,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_TAILWINDCSS,
    [ConfigDetectionTags.TAILWINDCSS, ConfigDetectionTags.CSS],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_JEST,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_JEST,
    [ConfigDetectionTags.JEST, ConfigDetectionTags.TESTING],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_VITEST,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_VITEST,
    [ConfigDetectionTags.VITEST, ConfigDetectionTags.TESTING],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_PG,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_PG,
    [ConfigDetectionTags.POSTGRES, ConfigDetectionTags.DATABASE],
  ),
  includesRule(
    ConfigRuleIds.PACKAGE_JSON_WORKSPACES,
    isPackageJson,
    ConfigMarkers.PACKAGE_JSON_WORKSPACES,
    [ConfigDetectionTags.MONOREPO],
  ),

  presenceRule(ConfigRuleIds.CARGO_BASE, isCargoToml, {
    projectType: ProjectTypes.RUST,
    tags: [ProjectTypes.RUST],
  }),
  includesRule(
    ConfigRuleIds.CARGO_TOKIO,
    isCargoToml,
    ConfigMarkers.CARGO_TOKIO,
    [ConfigDetectionTags.TOKIO, ConfigDetectionTags.ASYNC],
  ),
  includesRule(
    ConfigRuleIds.CARGO_ACTIX,
    isCargoToml,
    ConfigMarkers.CARGO_ACTIX,
    [ConfigDetectionTags.ACTIX, ConfigDetectionTags.BACKEND],
  ),
  includesRule(
    ConfigRuleIds.CARGO_SERDE,
    isCargoToml,
    ConfigMarkers.CARGO_SERDE,
    [ConfigDetectionTags.SERDE],
  ),
  includesRule(
    ConfigRuleIds.CARGO_TAURI,
    isCargoToml,
    ConfigMarkers.CARGO_TAURI,
    [ConfigDetectionTags.TAURI, ConfigDetectionTags.DESKTOP],
  ),

  presenceRule(ConfigRuleIds.PYTHON_BASE, isPythonMarker, {
    projectType: ProjectTypes.PYTHON,
    tags: [ProjectTypes.PYTHON],
  }),
  includesRule(
    ConfigRuleIds.PYTHON_DJANGO,
    isPythonMarker,
    ConfigMarkers.PYTHON_DJANGO,
    [ConfigDetectionTags.DJANGO, ConfigDetectionTags.BACKEND],
  ),
  includesRule(
    ConfigRuleIds.PYTHON_FASTAPI,
    isPythonMarker,
    ConfigMarkers.PYTHON_FASTAPI,
    [ConfigDetectionTags.FASTAPI, ConfigDetectionTags.BACKEND],
  ),
  includesRule(
    ConfigRuleIds.PYTHON_PANDAS,
    isPythonMarker,
    ConfigMarkers.PYTHON_PANDAS,
    [ConfigDetectionTags.PANDAS, ConfigDetectionTags.DATA],
  ),

  presenceRule(ConfigRuleIds.GO_BASE, isGoMod, {
    projectType: ProjectTypes.GO,
    tags: [ProjectTypes.GO],
  }),
  includesRule(ConfigRuleIds.GO_GIN, isGoMod, ConfigMarkers.GO_GIN, [
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
  `**/${ConfigFilePrefixes.WEBPACK_CONFIG}.*`,
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

      projectType = await this.scanAllConfigFiles(configFiles, suggestedTags);
      projectType = this.resolveJavascriptFallback(projectType, suggestedTags);
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

  /** Reads and applies detection rules to every discovered config file, returning the last project type a rule reported (or `ProjectTypes.UNKNOWN` if none did). */
  private async scanAllConfigFiles(
    configFiles: string[],
    suggestedTags: Set<string>,
  ): Promise<string> {
    let projectType: string = ProjectTypes.UNKNOWN;

    for (const file of configFiles) {
      const content = await this.readConfigFileContent(file);
      if (content === null) continue;

      const basename = path.basename(file);
      const detectedType = this.applyDetectionRules(
        basename,
        content,
        suggestedTags,
      );
      if (detectedType) projectType = detectedType;
    }

    return projectType;
  }

  /** Reads a single config file's content, returning `null` (to be skipped) if it can't be read. */
  private async readConfigFileContent(file: string): Promise<string | null> {
    try {
      return await fs.readFile(file, UTF8_ENCODING);
    } catch {
      return null;
    }
  }

  /** Runs every detection rule matching `basename` against `content`, merging matched tags into `suggestedTags` and returning the last matched project type, if any. */
  private applyDetectionRules(
    basename: string,
    content: string,
    suggestedTags: Set<string>,
  ): string | undefined {
    let projectType: string | undefined;

    for (const rule of CONFIG_DETECTION_RULES) {
      if (!rule.matchesFile(basename)) continue;
      const result = rule.detect(content);
      if (!result) continue;
      if (result.projectType) projectType = result.projectType;
      for (const tag of result.tags) suggestedTags.add(tag);
    }

    return projectType;
  }

  /** Falls back to `ProjectTypes.JAVASCRIPT` when JS/TS-family tags were detected but no rule pinned a more specific project type. */
  private resolveJavascriptFallback(
    projectType: string,
    suggestedTags: Set<string>,
  ): string {
    const hasJsFamilyIndicator =
      suggestedTags.has(ConfigTags.TYPESCRIPT) ||
      suggestedTags.has(ConfigTags.REACT) ||
      suggestedTags.has(ConfigTags.EXPRESS) ||
      suggestedTags.has(ConfigTags.VUE);

    if (hasJsFamilyIndicator && projectType === ProjectTypes.UNKNOWN) {
      return ProjectTypes.JAVASCRIPT;
    }

    return projectType;
  }
}
