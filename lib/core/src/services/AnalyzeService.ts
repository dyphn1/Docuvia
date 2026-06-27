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
        "pg": ["postgres", "database"]
      };

      for (const [dep, tags] of Object.entries(frameworkMapping)) {
        if (deps[dep]) {
          tags.forEach(t => suggestedTags.add(t));
        }
      }
    } catch {
      // package.json might not exist, ignore
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
