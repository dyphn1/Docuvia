import path from "path";
import fs from "fs/promises";

export class ExtractService {
  constructor(private workspaceRoot: string) {}

  public async extractDecisions(filePath: string): Promise<{ decisions: string[] }> {
    console.log(`[docuvia] Extracting decisions from ${filePath}`);
    
    const absolutePath = path.resolve(this.workspaceRoot, filePath);
    
    try {
      const content = await fs.readFile(absolutePath, "utf-8");
      const lines = content.split('\n');
      const decisions = new Set<string>();
      
      const importRegex = /^import\s+(?:.*?\s+from\s+)?['"](.*?)['"]/;
      const exportClassRegex = /^\s*export\s+(?:abstract\s+)?class\s+(\w+)/;
      const exportFunctionRegex = /^\s*export\s+(?:async\s+)?function\s+(\w+)/;
      const exportConstRegex = /^\s*export\s+const\s+(\w+)\s*=/;
      const decisionTagRegex = /@decision\s+(.+)/;

      for (const line of lines) {
        const decisionMatch = line.match(decisionTagRegex);
        if (decisionMatch) {
          decisions.add(`Explicit decision: ${decisionMatch[1].trim()}`);
        }

        const importMatch = line.match(importRegex);
        if (importMatch && !importMatch[1].startsWith('.')) {
          decisions.add(`Depends on external module: ${importMatch[1]}`);
        }

        const classMatch = line.match(exportClassRegex);
        if (classMatch) {
          decisions.add(`Defines class: ${classMatch[1]}`);
        }

        const fnMatch = line.match(exportFunctionRegex);
        if (fnMatch) {
          decisions.add(`Defines function: ${fnMatch[1]}`);
        }

        const constMatch = line.match(exportConstRegex);
        if (constMatch) {
          decisions.add(`Defines constant/arrow-function: ${constMatch[1]}`);
        }
      }

      if (decisions.size === 0) {
        if (content.includes("Hexagonal Architecture") || content.includes("hexagonal")) {
          decisions.add("Uses Hexagonal Architecture pattern");
        }
        if (content.includes("Drizzle") || content.includes("drizzle")) {
          decisions.add("Uses Drizzle ORM for database access");
        }
      }
      
      if (decisions.size === 0) {
        decisions.add("No explicit structural decisions extracted.");
      }
      
      return { decisions: Array.from(decisions) };
    } catch (e: any) {
      throw new Error(`Failed to read file ${filePath}: ${e.message}`);
    }
  }
}
