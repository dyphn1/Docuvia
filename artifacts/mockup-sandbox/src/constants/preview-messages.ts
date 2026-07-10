import { MOCKUP_FILE_EXTENSION } from "./mockups";

export const GALLERY_MESSAGES = {
  TITLE: "Component Preview Server",
  DESCRIPTION: "This server renders individual components for the workspace canvas.",
  ACCESS_HINT: "Access component previews at",
} as const;

export const PREVIEW_ERROR_MESSAGES = {
  COMPONENT_NOT_FOUND: (componentPath: string) =>
    `No component found at ${componentPath}${MOCKUP_FILE_EXTENSION}`,
  NO_EXPORTED_COMPONENT: (componentPath: string) =>
    `No exported React component found in ${componentPath}${MOCKUP_FILE_EXTENSION}\n\nMake sure the file has at least one exported function component.`,
  LOAD_FAILED: (message: string) => `Failed to load preview.\n${message}`,
} as const;
