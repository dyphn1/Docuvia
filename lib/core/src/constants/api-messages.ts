export const API_MESSAGES = {
  // Common (shared across many routes)
  NOT_FOUND: "Not found",
  PROJECT_NOT_FOUND: "Project not found",
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  INTERNAL_SERVER_ERROR: "Internal server error",
  SERVER_CONFIGURATION_ERROR: "Server configuration error",
  SERVER_MISCONFIGURATION: "Server misconfiguration",
  INVALID_PROJECT_ID: "Invalid project id",

  // Auth middleware / MCP auth
  AUTH_MISSING_ENV: (envVar: string) =>
    `${envVar} environment variable is not set. Refusing all requests.`,

  // Validation middleware fallbacks
  INVALID_REQUEST_BODY: "Invalid request body",
  INVALID_QUERY_PARAMETERS: "Invalid query parameters",

  // Documents
  INVALID_DOCUMENT_ID: "Invalid document id",
  DOCUMENT_NOT_FOUND: "Document not found",
  FILE_REQUIRED: "file required",
  MISC_POOL_QUOTA_EXCEEDED:
    "Misc Pool quota exceeded. Please associate existing documents to a project.",
  UPLOADED_FILE_PATH_MISSING: "Uploaded file path is missing",
  INVALID_SIGNATURE_PDF: "Invalid file signature. Not a true PDF.",
  INVALID_SIGNATURE_OFFICE: "Invalid file signature. Not a valid Office document.",

  // Generate
  INVALID_INPUT: "Invalid input",
  FAILED_TO_EXTRACT_DECISIONS: "Failed to extract decisions",
  FAILED_TO_GENERATE_KNOWLEDGE: "Failed to generate knowledge",
  PROJECT_ALREADY_INDEXING: "Project is already indexing or not in active state.",

  // Extensions (VSCode)
  BAD_REQUEST: "Bad request",
  PATH_QUERY_PARAM_REQUIRED: "path query param required",

  // Integrations
  INVALID_INTEGRATION_ID: "Invalid integration id",
  INTEGRATION_NOT_FOUND: "Integration not found",
  FAILED_TO_LIST_INTEGRATIONS: "Failed to list integrations",
  FAILED_TO_CREATE_INTEGRATION: "Failed to create integration",
  FAILED_TO_UPDATE_INTEGRATION: "Failed to update integration",
  FAILED_TO_DELETE_INTEGRATION: "Failed to delete integration",
  FAILED_TO_SEND_TEST_NOTIFICATION: "Failed to send test notification",

  // Ingest
  REPO_URL_REQUIRED: "repoUrl is required",
  INVALID_SVN_URL_FORMAT: "Invalid SVN URL format",
  NO_FILE_UPLOADED: "No file uploaded. Use multipart/form-data with field name 'file'.",
  DOCUMENT_ALREADY_EXISTS: "Document already exists",
  EXTRACTED_CONTENT_EMPTY:
    "Extracted content is empty. The document may be encrypted or contain only images.",
  JSONL_PATH_REQUIRED: "jsonlPath or jsonlPaths is required",
  FILE_TOO_LARGE: (maxSizeLabel: string) => `File too large. Maximum size is ${maxSizeLabel}.`,
  UNSUPPORTED_FILE_TYPE: (mimetype: string, ext: string) =>
    `Unsupported file type: ${mimetype} (.${ext})`,

  // Notifications
  FAILED_TO_LIST_NOTIFICATIONS: "Failed to list notifications",
  NOTIFICATION_NOT_FOUND: "Notification not found",
  FAILED_TO_MARK_NOTIFICATION_READ: "Failed to mark notification as read",
  FAILED_TO_MARK_ALL_NOTIFICATIONS_READ: "Failed to mark all notifications as read",

  // GitHub webhooks
  GITHUB_WEBHOOK_INVALID_PROJECT_ID: "Invalid projectId",
  MISSING_SIGNATURE_HEADER: "Missing signature header",
  INVALID_SIGNATURE: "Invalid signature",
  INVALID_JSON_PAYLOAD: "Invalid JSON payload",
  ACCEPTED: "Accepted",
  EVENT_IGNORED: "Event ignored",
  MISSING_PULL_REQUEST_PAYLOAD: "Missing pull_request payload",
  CANNOT_PARSE_REPOSITORY: "Cannot parse repository from payload",

  // Search
  SEARCH_FAILED: "Search failed",
  INVALID_FEEDBACK_PAYLOAD: "Invalid feedback payload",

  // Pull requests
  INVALID_PARAMETERS: "Invalid parameters",
  PULL_REQUEST_NOT_FOUND: "Pull request not found",
  PR_ALREADY_ANALYZED: "This PR has already been analyzed. Re-running analysis.",
  ANALYSIS_TRIGGERED: "Analysis triggered",

  // Sync
  INVALID_OUTBOX_PAYLOAD: "Invalid outbox payload",
  FORBIDDEN_NOT_PROJECT_OWNER: "Forbidden: Not project owner",
  SYNC_CONFLICT: "Sync conflict: Resource is currently locked by another client. Try again later.",
  SYNC_ONLY_SUPPORTED_FOR_GIT: "Sync is only supported for git projects",
  NO_NEW_COMMITS_TO_INGEST: "No new commits to ingest",

  // Templates
  INVALID_TEMPLATE_TYPE: "Invalid template type",

  // Review tasks (service throws this internally; route maps it to NOT_FOUND)
  TASK_NOT_FOUND: "Task not found",

  // Subscriptions
  SUBSCRIBER_PROJECT_NOT_FOUND: "Subscriber project not found",
  PUBLISHER_PROJECT_NOT_FOUND: "Publisher project not found",
  SUBSCRIPTION_ALREADY_EXISTS: "Subscription already exists",
  FAILED_TO_CREATE_SUBSCRIPTION: "Failed to create subscription",
  SUBSCRIPTION_NOT_FOUND: "Subscription not found",
  FAILED_TO_DELETE_SUBSCRIPTION: "Failed to delete subscription",
  FAILED_TO_LIST_SUBSCRIPTIONS: "Failed to list subscriptions",

  // Metabolism
  METABOLISM_ALREADY_RUNNING: "Metabolism is already running",
  METABOLISM_TICK_COMPLETED: "Metabolism tick completed",
  METABOLISM_TICK_COMPLETED_MANUALLY: "Metabolism tick completed manually",
  METABOLISM_TICK_FAILED: "Metabolism tick failed",

  // L2 nodes
  BOOTSTRAP_CONFIRMED: "Bootstrap confirmed successfully",

  // Rate limiting
  STANDARD_RATE_LIMIT_MESSAGE: "Too many requests from this IP, please try again later.",

  // Proxy
  STREAM_NOT_INITIALIZED: "Stream not initialized",
  COMPRESSED_BLOCK_INSTRUCTION:
    "System: Some large code blocks have been compressed. Use the `docuvia_retrieve_original` MCP tool with the provided COMPRESSED_SKELETON_ID if you need to read the full code.",

  // Dynamic messages added during cleanup
  FAILED_TO_PARSE_DOCUMENT: (msg: string) => `Failed to parse document: ${msg}`,
  INGESTION_FAILED: (errors: string) => `Ingestion failed: ${errors}`,
  L2_NODE_DOES_NOT_EXIST: (id: string | number) => `L2 Node ${id} does not exist`,

  // Startup
  PORT_REQUIRED: "PORT environment variable is required but was not provided.",
  INVALID_PORT: (port: string) => `Invalid PORT value: \"${port}\"`,
} as const;
