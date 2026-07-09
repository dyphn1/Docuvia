/**
 * Constants for the Chart component (Chart.tsx).
 */

// Format: { THEME_NAME: CSS_SELECTOR }
export const THEMES = { light: "", dark: ".dark" } as const;

export const DEFAULT_PAYLOAD_KEY = "value";

// Recharts marks a payload item as hidden from tooltip/legend rendering via this type value.
export const HIDDEN_PAYLOAD_TYPE = "none";
