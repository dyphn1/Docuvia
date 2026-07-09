// Documents.tsx
export const DOCUMENTS_TAB_UPLOAD = "upload";
export const DOCUMENTS_TAB_MISC_POOL = "misc";
export const DOCUMENTS_PAGE_TITLE = "Documents";
export const DOCUMENTS_PAGE_DESCRIPTION =
  "Ingest documents for knowledge extraction, or affiliate unaffiliated documents from the Misc Pool";
export const DOCUMENTS_TAB_UPLOAD_LABEL = "Upload";
export const DOCUMENTS_TAB_MISC_POOL_LABEL = "Misc Pool";

// Shared across Documents tabs
export const DOCUMENT_DATE_FORMAT_PATTERN = "MMM d, yyyy HH:mm";
export const LOADING_LABEL = "Loading...";

// AffiliateDialog.tsx
export const AFFILIATE_DIALOG_TITLE = "Associate with Project";
export const AFFILIATE_DIALOG_PROJECT_LABEL = "Project";
export const AFFILIATE_DIALOG_PROJECT_PLACEHOLDER = "Select project...";
export const AFFILIATE_DIALOG_ERROR_FALLBACK = "Failed to affiliate document";
export const AFFILIATE_DIALOG_CANCEL_LABEL = "Cancel";
export const AFFILIATE_DIALOG_CONFIRM_LABEL = "Confirm";
export const AFFILIATE_DIALOG_ASSOCIATING_LABEL = "Associating...";

// MiscPoolTab.tsx
export const MISC_POOL_CARD_TITLE = "Unaffiliated Documents";
export const MISC_POOL_ERROR_LABEL = "Failed to load misc pool";
export const MISC_POOL_EMPTY_LABEL = "No unaffiliated documents";
export const MISC_POOL_ASSOCIATE_BUTTON_LABEL = "Associate with Project";

// UploadTab.tsx
export const ACCEPTED_UPLOAD_FILE_TYPES = ".md,.txt,.markdown,.log,.map";
export const UPLOAD_CARD_TITLE = "Upload Document";
export const UPLOAD_PROJECT_LABEL = "Project";
export const UPLOAD_PROJECT_OPTIONAL_LABEL = "(optional)";
export const UPLOAD_PROJECT_PLACEHOLDER = "No project — goes to Misc Pool";
export const UPLOAD_NO_PROJECT_HINT =
  "Without a project, the document will be saved to the Misc Pool for later affiliation.";
export const UPLOAD_FILE_FIELD_LABEL = "Upload File (MD, TXT)";
export const UPLOAD_DROPZONE_HINT = "Click to upload or drag & drop";
export const UPLOAD_DROPZONE_FILETYPES_HINT = ".md, .txt, .log, .map files";
export const UPLOAD_OR_PASTE_MANUALLY_LABEL = "or paste manually";
export const UPLOAD_FILENAME_LABEL = "Filename";
export const UPLOAD_FILENAME_PLACEHOLDER = "README.md";
export const UPLOAD_CONTENT_LABEL = "Content";
export const UPLOAD_CONTENT_PLACEHOLDER = "Paste document content here...";
export const UPLOAD_INGESTING_LABEL = "Ingesting...";
export const UPLOAD_INGEST_DOCUMENT_LABEL = "Ingest Document";
export const UPLOAD_SAVE_TO_MISC_POOL_LABEL = "Save to Misc Pool";
export const UPLOAD_SUCCESS_MESSAGE = "Document ingested successfully";
export const UPLOAD_PROJECT_DOCUMENTS_CARD_TITLE = "Project Documents";
export const UPLOAD_SELECT_PROJECT_HINT = "Select a project to view its documents";
export const UPLOAD_NO_DOCUMENTS_LABEL = "No documents ingested yet";
export const UPLOAD_CHARS_SUFFIX_LABEL = "chars";

// useUploadDocumentForm.ts
export const PLAIN_TEXT_MIME_TYPE = "text/plain";
export const UPLOAD_FORM_DEFAULT_ERROR_MESSAGE = "Unknown error";
