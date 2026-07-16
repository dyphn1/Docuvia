import type { IGitProvider, IVcsScanner, ILogger } from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import {
  DISCOVERY_MESSAGES,
  VCS_IGNORED_TOP_LEVEL_DIRS,
  VCS_NON_DOMAIN_DIRS,
  SRC_DIR_SEGMENT,
} from "./discovery-constants.js";

/** Hidden-entry marker (`.git`, `.env`, ...) used to skip dotfiles/dot-directories while deriving a domain. */
const HIDDEN_ENTRY_PREFIX = ".";

/** Workspace top-level directories under which the real source root is one level deeper (`packages/cli/src/...`). */
const NESTED_SRC_ROOT_DIRS = ["packages", "artifacts", "crates"];

/** Prefix `VcsScannerService` adds to a derived functional domain before surfacing it as a suggested tag. */
const DOMAIN_TAG_PREFIX = "domain:";

/**
 * Constructs a meaningful domain prefix from a changed path's segments (e.g., 'cli',
 * 'core/ingestion' -> 'core', 'mcp'), handling the workspace `packages/<name>/src/...` nesting
 * convention as well as plain `src/<domain>/...` and top-level-folder layouts.
 */
function deriveDomainPrefix(parts: string[]): string {
  if (parts[0] === SRC_DIR_SEGMENT && parts.length > 1) {
    return parts[1]; // src/auth -> auth
  }
  if (parts.length > 2 && parts[1] === SRC_DIR_SEGMENT) {
    // Workspaces: packages/cli/src/mcp -> cli
    return NESTED_SRC_ROOT_DIRS.includes(parts[0]) ? parts[1] : parts[0];
  }
  // Direct top-level folders that aren't src
  return parts[0];
}

/**
 * Resolves a single trimmed changed-file path (depth > 1) to its functional domain, or `null`
 * when the path's top-level folder or derived domain should be excluded (config/hidden folders,
 * build directories, or purely structural directories).
 */
function extractDomainFromChangedPath(trimmed: string): string | null {
  const parts = trimmed.split("/");
  if (parts.length <= 1) return null;

  // Defend against config/hidden folders and build directories
  if (
    parts[0].startsWith(HIDDEN_ENTRY_PREFIX) ||
    VCS_IGNORED_TOP_LEVEL_DIRS.includes(parts[0])
  ) {
    return null;
  }

  const domain = deriveDomainPrefix(parts);

  // Ensure the domain itself isn't a file, hidden, or purely structural
  if (
    domain.includes(HIDDEN_ENTRY_PREFIX) ||
    domain.startsWith(HIDDEN_ENTRY_PREFIX) ||
    VCS_NON_DOMAIN_DIRS.includes(domain)
  ) {
    return null;
  }

  return domain;
}

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

      const pathCounts = this.countChangedPathDomains(changedPaths);

      // Sort by frequency and pick the top 5 functional hotspots
      const sortedDomains = this.selectTopDomains(pathCounts);

      for (const domain of sortedDomains) {
        if (domain.length > 2) {
          // Ignore extremely short/cryptic folders
          suggestedTags.add(`${DOMAIN_TAG_PREFIX}${domain}`);
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

  /** Splits each changed-file line into a directory-depth-aware domain and tallies how often each domain recurs. */
  private countChangedPathDomains(changedPaths: string[]): Map<string, number> {
    const pathCounts = new Map<string, number>();

    for (const line of changedPaths) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const domain = extractDomainFromChangedPath(trimmed);
      if (!domain) continue;

      pathCounts.set(domain, (pathCounts.get(domain) || 0) + 1);
    }

    return pathCounts;
  }

  /** Orders domains by descending change frequency and returns the top 5 candidate hotspot names. */
  private selectTopDomains(pathCounts: Map<string, number>): string[] {
    return Array.from(pathCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((entry) => entry[0]);
  }
}
