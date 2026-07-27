import { ui } from "../ui/wizard.js";
import { CLI_ERROR_MESSAGES } from "../constants/cli-errors.js";
import {
  CursorPlatform,
  ClaudePlatform,
  CopilotPlatform,
  CodexPlatform,
  ContinuePlatform,
  HermesPlatform,
} from "../platforms/index.js";
import type { BasePlatform } from "../platforms/base.platform.js";

export function getAvailablePlatforms(): BasePlatform[] {
  return [
    new CursorPlatform(),
    new ClaudePlatform(),
    new CopilotPlatform(),
    new CodexPlatform(),
    new ContinuePlatform(),
    new HermesPlatform(),
  ];
}

function parsePlatformSlugs(platformFlagValue: string): string[] {
  return platformFlagValue
    .split(",")
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolves which platforms a command should act on:
 * - `--platform=` present -> exact slugs requested (throws on unknown slugs), no prompt.
 * - absent + isInteractive -> interactive checkbox, defaulting every platform to checked.
 *   Opt-in via `--interactive`/`-i` (IFCE-004) -- no longer a bare `stdin.isTTY` auto-trigger.
 * - absent + !isInteractive -> every available platform (today's unconditional default, preserved).
 */
export async function selectPlatforms(
  promptMessage: string,
  platformFlagValue: string | undefined,
  isInteractive: boolean,
  availablePlatforms: BasePlatform[] = getAvailablePlatforms(),
): Promise<BasePlatform[]> {
  if (platformFlagValue !== undefined) {
    const requestedSlugs = parsePlatformSlugs(platformFlagValue);
    const knownSlugs = availablePlatforms.map((p) => p.slug);
    const unknownSlugs = requestedSlugs.filter(
      (slug) => !knownSlugs.includes(slug),
    );
    if (unknownSlugs.length > 0) {
      throw new Error(
        CLI_ERROR_MESSAGES.UNKNOWN_PLATFORMS(
          unknownSlugs.join(", "),
          knownSlugs.join(", "),
        ),
      );
    }
    return availablePlatforms.filter((p) => requestedSlugs.includes(p.slug));
  }

  if (isInteractive) {
    const choices = availablePlatforms.map((p) => ({
      name: p.name,
      value: p.name,
      checked: true,
    }));
    const selectedNames = await ui.askCheckbox(promptMessage, choices);
    return availablePlatforms.filter((p) => selectedNames.includes(p.name));
  }

  return availablePlatforms;
}
