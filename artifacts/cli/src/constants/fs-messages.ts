export const FS_MESSAGES = {
  APPENDED: (filePath: string) => `Appended instructions to: ${filePath}`,
  ALREADY_EXISTS: (filePath: string) => `Instructions already exist in: ${filePath}`,
  CREATED: (filePath: string) => `Created: ${filePath}`,
} as const;
