export const CLI_ERROR_MESSAGES = {
  UNKNOWN_OPTIONS: (options: string) => `Unknown options provided: ${options}`,
  UNKNOWN_PLATFORMS: (unknown: string, known: string) =>
    `Unknown --platform value(s): ${unknown}. Available platforms: ${known}`,
  WORKSPACE_ROOT_EMPTY: "workspace root must not be empty",
  HEAD_REQUIRES_VALUE:
    "The --head flag requires a non-empty ref value (usage: --head <ref>).",
  INVALID_FORMAT: (raw: string, known: string) =>
    `Unknown --format value: ${raw}. Available formats: ${known}`,
} as const;
