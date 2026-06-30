export function sanitizeLikeInput(input: string): string {
  if (!input) return "";
  // Escape PostgreSQL LIKE wildcards: % and _ using a backslash
  return input.replace(/([%_\\])/g, "\\\\$1");
}
