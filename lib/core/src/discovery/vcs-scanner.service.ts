import type { IGitProvider, IVcsScanner, ILogger } from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import {
  DISCOVERY_MESSAGES,
  VCS_IGNORED_TOP_LEVEL_DIRS,
  VCS_NON_DOMAIN_DIRS,
} from "./discovery-constants.js";

export class VcsScannerService implements IVcsScanner {
  constructor(
    private readonly git: IGitProvider,
    private readonly logger: ILogger = createNoopLogger(),
  ) {}

  public async extractHotspotTags(workspaceRoot: string): Promise<string[]> {
    const suggestedTags = new Set<string>();
    try {
      // --- VCS-Driven Hotspot Extraction (ADR-005) ---
      const isGit = await this.git.isGitRepository(workspaceRoot);
      if (!isGit) return [];

      const changedPaths = await this.git.getRecentChangedFilePaths(
        workspaceRoot,
        100,
      );

      const pathCounts = new Map<string, number>();

      for (const line of changedPaths) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Split path and get up to depth 3 directories
        const parts = trimmed.split("/");
        if (parts.length > 1) {
          // Defend against config/hidden folders and build directories
          if (
            parts[0].startsWith(".") ||
            VCS_IGNORED_TOP_LEVEL_DIRS.includes(parts[0])
          )
            continue;

          // Construct a meaningful domain prefix (e.g., 'cli', 'core/ingestion', 'mcp')
          let domain = "";
          if (parts[0] === "src" && parts.length > 1) {
            domain = parts[1]; // src/auth -> auth
          } else if (parts.length > 2 && parts[1] === "src") {
            // Workspaces: packages/cli/src/mcp -> cli
            domain =
              parts[0] === "packages" ||
              parts[0] === "artifacts" ||
              parts[0] === "crates"
                ? parts[1]
                : parts[0];
          } else {
            // Direct top-level folders that aren't src
            domain = parts[0];
          }

          // Ensure the domain itself isn't a file, hidden, or purely structural
          if (
            !domain.includes(".") &&
            !domain.startsWith(".") &&
            !VCS_NON_DOMAIN_DIRS.includes(domain)
          ) {
            pathCounts.set(domain, (pathCounts.get(domain) || 0) + 1);
          }
        }
      }

      // Sort by frequency and pick the top 5 functional hotspots
      const sortedDomains = Array.from(pathCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map((entry) => entry[0]);

      for (const domain of sortedDomains) {
        if (domain.length > 2) {
          // Ignore extremely short/cryptic folders
          suggestedTags.add(`domain:${domain}`);
        }
      }

      if (sortedDomains.length > 0) {
        this.logger.debug(DISCOVERY_MESSAGES.VCS_HOTSPOT_DOMAINS_EXTRACTED, {
          domains: sortedDomains,
        });
      }
    } catch {
      // Git not available or no commits yet, gracefully skip VCS hotspot extraction
    }

    return Array.from(suggestedTags);
  }
}
