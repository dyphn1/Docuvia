export const CLI_ERROR_MESSAGES = {
  UNKNOWN_OPTIONS: (options: string) => `Unknown options provided: ${options}`,
  UNKNOWN_PLATFORMS: (unknown: string, known: string) =>
    `Unknown --platform value(s): ${unknown}. Available platforms: ${known}`,
  WORKSPACE_ROOT_EMPTY: "workspace root must not be empty",
} as const;
