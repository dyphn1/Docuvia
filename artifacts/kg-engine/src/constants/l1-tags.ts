export const DEFAULT_TAG_CATEGORY = "domain";
export const TABLE_COLUMN_COUNT = 7;
export const CREATED_DATE_FORMAT = "MMM d, yyyy";

export const L1_TAGS_PAGE_TITLE = "L1 Tags";
export const L1_TAGS_PAGE_SUBTITLE = "Global domain concepts and taxonomy";

export const NEW_L1_TAG_BUTTON_TEXT = "New L1 Tag";
export const CREATE_L1_TAG_DIALOG_TITLE = "Create L1 Tag";

export const TAG_NAME_LABEL = "Tag Name";
export const TAG_NAME_PLACEHOLDER = "e.g. Authentication";
export const TAG_CATEGORY_LABEL = "Category";
export const TAG_CATEGORY_PLACEHOLDER = "e.g. domain, infrastructure";
export const TAG_DESCRIPTION_LABEL = "Description";
export const TAG_DESCRIPTION_PLACEHOLDER = "Optional description";

export const CREATE_TAG_BUTTON_PENDING_TEXT = "Creating...";
export const CREATE_TAG_BUTTON_TEXT = "Create Tag";

export const SEARCH_TAGS_PLACEHOLDER = "Search tags...";

export const TABLE_HEADERS = {
  tag: "Tag",
  category: "Category",
  description: "Description",
  anchored: "Anchored",
  usage: "Usage",
  created: "Created",
} as const;

export const LOADING_TAGS_MESSAGE = "Loading tags...";
export const NO_TAGS_FOUND_MESSAGE = "No tags found.";
export const EMPTY_DESCRIPTION_PLACEHOLDER = "—";

export const INITIAL_NEW_TAG_FORM = {
  name: "",
  category: DEFAULT_TAG_CATEGORY,
  description: "",
};
