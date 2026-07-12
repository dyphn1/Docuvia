export const CLI_ERROR_MESSAGES = {
  UNKNOWN_OPTIONS: (options: string) => `Unknown options provided: ${options}`,
  UNKNOWN_PLATFORMS: (unknown: string, known: string) =>
    `Unknown --platform value(s): ${unknown}. Available platforms: ${known}`,
} as const;
