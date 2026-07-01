import fg from "fast-glob";
import path from "path";
import fs from "fs/promises";
import { IConfigScanner } from "../interfaces/analyzer.interfaces.js";

export class ConfigScannerService implements IConfigScanner {
  public async scanConfigs(
    workspaceRoot: string
  ): Promise<{ projectType: string; tags: string[] }> {
    let projectType = "unknown";
    const suggestedTags = new Set<string>();

    try {
      const configFiles = await fg(
        [
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
        ],
        {
          cwd: workspaceRoot,
          ignore: [
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
          ],
          absolute: true,
          deep: 3,
        }
      );

      for (const file of configFiles) {
        const basename = path.basename(file);
        try {
          const content = await fs.readFile(file, "utf-8");

          if (basename === "package.json") {
            if (content.includes('"typescript"')) suggestedTags.add("typescript");
            if (content.includes('"react"')) {
              suggestedTags.add("react");
              suggestedTags.add("frontend");
            }
            if (content.includes('"vue"')) {
              suggestedTags.add("vue");
              suggestedTags.add("frontend");
            }
            if (content.includes('"next"')) {
              suggestedTags.add("nextjs");
              suggestedTags.add("frontend");
              suggestedTags.add("ssr");
            }
            if (content.includes('"express"')) {
              suggestedTags.add("express");
              suggestedTags.add("backend");
            }
            if (content.includes('"drizzle-orm"')) {
              suggestedTags.add("drizzle");
              suggestedTags.add("database");
            }
            if (content.includes('"tailwindcss"')) {
              suggestedTags.add("tailwindcss");
              suggestedTags.add("css");
            }
            if (content.includes('"jest"')) {
              suggestedTags.add("jest");
              suggestedTags.add("testing");
            }
            if (content.includes('"vitest"')) {
              suggestedTags.add("vitest");
              suggestedTags.add("testing");
            }
            if (content.includes('"pg"')) {
              suggestedTags.add("postgres");
              suggestedTags.add("database");
            }
            if (content.includes('"workspaces"')) suggestedTags.add("monorepo");
          } else if (basename === "Cargo.toml") {
            projectType = "rust";
            suggestedTags.add("rust");
            if (content.includes("tokio")) {
              suggestedTags.add("tokio");
              suggestedTags.add("async");
            }
            if (content.includes("actix")) {
              suggestedTags.add("actix");
              suggestedTags.add("backend");
            }
            if (content.includes("serde")) suggestedTags.add("serde");
            if (content.includes("tauri")) {
              suggestedTags.add("tauri");
              suggestedTags.add("desktop");
            }
          } else if (basename === "pyproject.toml" || basename === "requirements.txt") {
            projectType = "python";
            suggestedTags.add("python");
            if (content.includes("django")) {
              suggestedTags.add("django");
              suggestedTags.add("backend");
            }
            if (content.includes("fastapi")) {
              suggestedTags.add("fastapi");
              suggestedTags.add("backend");
            }
            if (content.includes("pandas")) {
              suggestedTags.add("pandas");
              suggestedTags.add("data");
            }
          } else if (basename === "go.mod") {
            projectType = "go";
            suggestedTags.add("go");
            if (content.includes("gin-gonic")) {
              suggestedTags.add("gin");
              suggestedTags.add("backend");
            }
          } else if (basename === "tsconfig.json") {
            if (/"strict"\s*:\s*true/.test(content)) suggestedTags.add("strict-ts");
          } else if (basename.startsWith("vite.config")) {
            suggestedTags.add("vite");
            suggestedTags.add("build-tool");
          } else if (basename.startsWith("drizzle.config")) {
            suggestedTags.add("drizzle");
            suggestedTags.add("database");
          } else if (basename.startsWith("tauri.conf")) {
            suggestedTags.add("tauri");
            suggestedTags.add("desktop");
          }
        } catch (e) {
          // ignore read errors for individual files
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
      console.warn(`[docuvia] Warning: Failed multi-dimensional config scanning: ${e.message}`);
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
