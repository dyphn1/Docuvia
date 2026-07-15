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

const isPackageJson = exact("package.json");
const isCargoToml = exact("Cargo.toml");
const isPythonMarker = (basename: string) =>
  basename === "pyproject.toml" || basename === "requirements.txt";
const isGoMod = exact("go.mod");
const isTsconfig = exact("tsconfig.json");

export const CONFIG_DETECTION_RULES: ConfigDetectionRule[] = [
  includesRule("package.json:typescript", isPackageJson, '"typescript"', [
    ConfigTags.TYPESCRIPT,
  ]),
  includesRule("package.json:react", isPackageJson, '"react"', [
    ConfigTags.REACT,
    "frontend",
  ]),
  includesRule("package.json:vue", isPackageJson, '"vue"', [
    ConfigTags.VUE,
    "frontend",
  ]),
  includesRule("package.json:next", isPackageJson, '"next"', [
    "nextjs",
    "frontend",
    "ssr",
  ]),
  includesRule("package.json:express", isPackageJson, '"express"', [
    ConfigTags.EXPRESS,
    "backend",
  ]),
  includesRule("package.json:drizzle-orm", isPackageJson, '"drizzle-orm"', [
    "drizzle",
    "database",
  ]),
  includesRule("package.json:tailwindcss", isPackageJson, '"tailwindcss"', [
    "tailwindcss",
    "css",
  ]),
  includesRule("package.json:jest", isPackageJson, '"jest"', [
    "jest",
    "testing",
  ]),
  includesRule("package.json:vitest", isPackageJson, '"vitest"', [
    "vitest",
    "testing",
  ]),
  includesRule("package.json:pg", isPackageJson, '"pg"', [
    "postgres",
    "database",
  ]),
  includesRule("package.json:workspaces", isPackageJson, '"workspaces"', [
    "monorepo",
  ]),

  presenceRule("cargo:base", isCargoToml, {
    projectType: "rust",
    tags: ["rust"],
  }),
  includesRule("cargo:tokio", isCargoToml, "tokio", ["tokio", "async"]),
  includesRule("cargo:actix", isCargoToml, "actix", ["actix", "backend"]),
  includesRule("cargo:serde", isCargoToml, "serde", ["serde"]),
  includesRule("cargo:tauri", isCargoToml, "tauri", ["tauri", "desktop"]),

  presenceRule("python:base", isPythonMarker, {
    projectType: "python",
    tags: ["python"],
  }),
  includesRule("python:django", isPythonMarker, "django", [
    "django",
    "backend",
  ]),
  includesRule("python:fastapi", isPythonMarker, "fastapi", [
    "fastapi",
    "backend",
  ]),
  includesRule("python:pandas", isPythonMarker, "pandas", ["pandas", "data"]),

  presenceRule("go:base", isGoMod, { projectType: "go", tags: ["go"] }),
  includesRule("go:gin", isGoMod, "gin-gonic", ["gin", "backend"]),

  {
    id: "tsconfig:strict",
    matchesFile: isTsconfig,
    detect: (content) =>
      /"strict"\s*:\s*true/.test(content) ? { tags: ["strict-ts"] } : null,
  },

  presenceRule("vite:presence", prefix("vite.config"), {
    tags: ["vite", "build-tool"],
  }),
  presenceRule("drizzle:presence", prefix("drizzle.config"), {
    tags: ["drizzle", "database"],
  }),
  presenceRule("tauri:presence", prefix("tauri.conf"), {
    tags: ["tauri", "desktop"],
  }),
];

const CONFIG_GLOB_PATTERNS = [
  "**/package.json",
  "**/Cargo.toml",
  "**/pyproject.toml",
  "**/requirements.txt",
  "**/go.mod",
  "**/tsconfig.json",
  "**/vite.config.*",
  "**/drizzle.config.*",
  "**/webpack.config.*",
  "**/tauri.conf.*",
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
