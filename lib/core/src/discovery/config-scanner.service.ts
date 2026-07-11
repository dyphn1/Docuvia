import fg from "fast-glob";
import path from "path";
import fs from "fs/promises";
import type { IConfigScanner, ILogger } from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";

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
  tags: string[]
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
  result: ConfigDetectionResult
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
  includesRule("package.json:typescript", isPackageJson, '"typescript"', ["typescript"]),
  includesRule("package.json:react", isPackageJson, '"react"', ["react", "frontend"]),
  includesRule("package.json:vue", isPackageJson, '"vue"', ["vue", "frontend"]),
  includesRule("package.json:next", isPackageJson, '"next"', ["nextjs", "frontend", "ssr"]),
  includesRule("package.json:express", isPackageJson, '"express"', ["express", "backend"]),
  includesRule("package.json:drizzle-orm", isPackageJson, '"drizzle-orm"', ["drizzle", "database"]),
  includesRule("package.json:tailwindcss", isPackageJson, '"tailwindcss"', ["tailwindcss", "css"]),
  includesRule("package.json:jest", isPackageJson, '"jest"', ["jest", "testing"]),
  includesRule("package.json:vitest", isPackageJson, '"vitest"', ["vitest", "testing"]),
  includesRule("package.json:pg", isPackageJson, '"pg"', ["postgres", "database"]),
  includesRule("package.json:workspaces", isPackageJson, '"workspaces"', ["monorepo"]),

  presenceRule("cargo:base", isCargoToml, { projectType: "rust", tags: ["rust"] }),
  includesRule("cargo:tokio", isCargoToml, "tokio", ["tokio", "async"]),
  includesRule("cargo:actix", isCargoToml, "actix", ["actix", "backend"]),
  includesRule("cargo:serde", isCargoToml, "serde", ["serde"]),
  includesRule("cargo:tauri", isCargoToml, "tauri", ["tauri", "desktop"]),

  presenceRule("python:base", isPythonMarker, { projectType: "python", tags: ["python"] }),
  includesRule("python:django", isPythonMarker, "django", ["django", "backend"]),
  includesRule("python:fastapi", isPythonMarker, "fastapi", ["fastapi", "backend"]),
  includesRule("python:pandas", isPythonMarker, "pandas", ["pandas", "data"]),

  presenceRule("go:base", isGoMod, { projectType: "go", tags: ["go"] }),
  includesRule("go:gin", isGoMod, "gin-gonic", ["gin", "backend"]),

  {
    id: "tsconfig:strict",
    matchesFile: isTsconfig,
    detect: (content) => (/"strict"\s*:\s*true/.test(content) ? { tags: ["strict-ts"] } : null),
  },

  presenceRule("vite:presence", prefix("vite.config"), { tags: ["vite", "build-tool"] }),
  presenceRule("drizzle:presence", prefix("drizzle.config"), { tags: ["drizzle", "database"] }),
  presenceRule("tauri:presence", prefix("tauri.conf"), { tags: ["tauri", "desktop"] }),
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
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
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
    workspaceRoot: string
  ): Promise<{ projectType: string; tags: string[] }> {
    let projectType = "unknown";
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
          content = await fs.readFile(file, "utf-8");
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
        suggestedTags.has("typescript") ||
        suggestedTags.has("react") ||
        suggestedTags.has("express") ||
        suggestedTags.has("vue")
      ) {
        if (projectType === "unknown") projectType = "javascript";
      }
    } catch (e: any) {
      this.logger.warn("Config scanning failed", { error: e?.message ?? String(e) });
    }

    if (projectType === "unknown") {
      projectType = "generic";
    }

    if (suggestedTags.size === 0) {
      suggestedTags.add("general");
    }

    return { projectType, tags: Array.from(suggestedTags) };
  }
}
