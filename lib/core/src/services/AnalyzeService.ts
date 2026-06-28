import path from "path";
import fs from "fs/promises";

export class AnalyzeService {
  constructor(private workspaceRoot: string) {}

  public async analyzeProject(): Promise<{ projectType: string; suggestedTags: string[] }> {
    console.log(`[docuvia] Analyzing project in ${this.workspaceRoot}`);

    let projectType = "unknown";
    const suggestedTags = new Set<string>();

    try {
      const packageJsonPath = path.join(this.workspaceRoot, "package.json");
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);

      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      if (deps.typescript) {
        projectType = "typescript";
        suggestedTags.add("typescript");
      } else if (deps.react || deps.express || deps.vue || deps.next) {
        projectType = "javascript";
      }

      const frameworkMapping: Record<string, string[]> = {
        react: ["react", "frontend"],
        "react-dom": ["react", "frontend"],
        express: ["express", "backend"],
        vue: ["vue", "frontend"],
        next: ["nextjs", "frontend", "ssr"],
        "drizzle-orm": ["drizzle", "database"],
        vite: ["vite", "build-tool"],
        tailwindcss: ["tailwindcss", "css"],
        jest: ["jest", "testing"],
        vitest: ["vitest", "testing"],
        pg: ["postgres", "database"],
      };

      for (const [dep, tags] of Object.entries(frameworkMapping)) {
        if (deps[dep]) {
          tags.forEach((t) => suggestedTags.add(t));
        }
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.warn(`[docuvia] Warning: Failed to process package.json: ${e.message}`);
      }
    }

    try {
      const tsconfigPath = path.join(this.workspaceRoot, "tsconfig.json");
      await fs.access(tsconfigPath);
      const tsconfigContent = await fs.readFile(tsconfigPath, "utf-8");
      
      let isStrict = false;
      try {
        const parsed = JSON.parse(tsconfigContent);
        if (parsed?.compilerOptions?.strict === true) {
          isStrict = true;
        }
      } catch (parseError: any) {
        // Fallback to regex if JSON.parse fails due to comments
        if (/"strict"\s*:\s*true/.test(tsconfigContent)) {
          isStrict = true;
        } else {
          console.warn(`[docuvia] Warning: Failed to parse tsconfig.json: ${parseError.message}`);
        }
      }

      if (isStrict) {
        suggestedTags.add("strict-ts");
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.warn(`[docuvia] Warning: Failed to process tsconfig.json: ${e.message}`);
      }
    }

    const checkFileExists = async (filename: string) => {
      try {
        await fs.stat(path.join(this.workspaceRoot, filename));
        return true;
      } catch (e: any) {
        if (e.code !== "ENOENT") {
          console.warn(`[docuvia] Warning: Failed to stat ${filename}: ${e.message}`);
        }
        return false;
      }
    };

    if (await checkFileExists("vite.config.ts") || await checkFileExists("vite.config.js")) {
      suggestedTags.add("vite");
    }

    if (await checkFileExists("drizzle.config.ts") || await checkFileExists("drizzle.config.cjs") || await checkFileExists("drizzle.config.js")) {
      suggestedTags.add("drizzle");
    }

    if (projectType === "unknown") {
      projectType = "generic";
    }

    if (suggestedTags.size === 0) {
      suggestedTags.add("general");
    }

    return { projectType, suggestedTags: Array.from(suggestedTags) };
  }
}
