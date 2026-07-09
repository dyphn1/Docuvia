// Shared constants for the Templates pages (Templates.tsx, templates/*).

// --- Layout / sizing ---

export const PROJECT_LIST_SKELETON_COUNT = 3;
export const PROJECT_TEMPLATES_SKELETON_COUNT = 3;

// --- Thresholds ---

export const MIN_PROMPT_LENGTH = 10;

// --- Template metadata ---

export const TEMPLATE_META = {
  l1_tagger: {
    label: "L1 Tagger",
    description:
      "System prompt for extracting high-level domain classification tags from commit messages.",
    color: "border-blue-500/40 text-blue-400",
  },
  l2_extractor: {
    label: "L2 Extractor",
    description:
      "System prompt for identifying software components, modules, and packages from commit history.",
    color: "border-purple-500/40 text-purple-400",
  },
  l3_generator: {
    label: "L3 Generator",
    description:
      "System prompt for generating implementation rules, technical decisions, and rationale.",
    color: "border-green-500/40 text-green-400",
  },
};

// --- Templates page copy ---

export const TEMPLATES_PAGE_TITLE = "Prompt Templates";
export const TEMPLATES_PAGE_SUBTITLE =
  "Customize the AI system prompts used during knowledge graph generation for each project. Edits override the global default and are used on the next generation run.";
export const TEMPLATES_PROJECTS_SIDEBAR_LABEL = "Projects";
export const TEMPLATES_NO_PROJECTS_MESSAGE = "No projects found.";
export const TEMPLATES_SELECT_PROJECT_MESSAGE = "Select a project to manage its prompt templates.";
export const TEMPLATES_SELECT_PROJECT_HELPER_TEXT =
  "Each template controls how AI generates L1 tags, L2 components, and L3 knowledge nodes.";

// --- TemplateEditor copy ---

export const TEMPLATE_SAVED_TOAST_TITLE = "Template saved";
export const TEMPLATE_SAVED_TOAST_DESCRIPTION = "Prompt template updated successfully.";
export const TEMPLATE_SAVE_FAILED_TOAST_TITLE = "Save failed";
export const TEMPLATE_SAVE_FAILED_TOAST_DESCRIPTION = "Failed to update the template.";
export const TEMPLATE_RESET_TOAST_TITLE = "Template reset";
export const TEMPLATE_RESET_TOAST_DESCRIPTION = "Reverted to the global default prompt.";
export const TEMPLATE_RESET_FAILED_TOAST_TITLE = "Reset failed";
export const TEMPLATE_RESET_FAILED_TOAST_DESCRIPTION = "Failed to reset the template.";
export const TEMPLATE_CUSTOM_BADGE_LABEL = "Custom";
export const TEMPLATE_DEFAULT_BADGE_LABEL = "Default";
export const TEMPLATE_UPDATED_LABEL_PREFIX = "Updated";
export const TEMPLATE_RESET_TITLE_ATTR = "Reset to global default";
export const TEMPLATE_RESET_BUTTON_LABEL = "Reset";
export const TEMPLATE_EDIT_BUTTON_LABEL = "Edit";
export const TEMPLATE_CANCEL_BUTTON_LABEL = "Cancel";
export const TEMPLATE_PROMPT_PLACEHOLDER = "Enter your custom system prompt...";
export const TEMPLATE_SAVING_LABEL = "Saving...";
export const TEMPLATE_SAVE_BUTTON_LABEL = "Save Template";
