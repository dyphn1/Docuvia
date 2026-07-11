export const CLI_FLAGS = {
  DEEP: "--deep",
  LOCAL: "--local",
  FORMAT: "--format=",
  BASE_REF: "--baseRef=",
  TOPOLOGY: "--topology",
  JSON: "--json",
  OUT: "--out=",
  COLLAPSE: "--collapse=",
  GLOBAL: "--global",
} as const;

export const CLI_FORMAT_OPTIONS = {
  HUMAN: "human",
  PROMPT: "prompt",
} as const;

export const CLI_COLLAPSE_OPTIONS = {
  FILE: "file",
  SYMBOL: "symbol",
  AUTO: "auto",
} as const;
