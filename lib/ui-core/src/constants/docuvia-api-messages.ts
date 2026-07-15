/** Error messages for `docuvia-api.ts` — the package-wide orchestration entry point, not scoped to any single workflow. */
export const DOCUVIA_API_MESSAGES = {
  MISSING_MEMORY_KEY: (key: string, scopeId: string) =>
    `docuviaApi: no "${key}" set in memory scope "${scopeId}"`,
} as const;
