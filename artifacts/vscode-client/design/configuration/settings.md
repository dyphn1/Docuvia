# Docuvia Configuration Settings

Defined in `package.json` -> `contributes.configuration`.

## Settings List

### `docuvia.search.defaultView`
- **Type**: `string`
- **Default**: `"chat"`
- **Enum**: `["chat", "webview"]`
- **Description**: Where to display cross-project search results by default. If set to `chat`, it pre-fills the GitHub Copilot Chat with `@docuvia /query <text>`. If set to `webview`, it opens a dedicated VS Code webview panel.

### `docuvia.extraction.includePatterns`
- **Type**: `array` of `string`
- **Default**: `["**/*.ts", "**/*.js", "**/*.tsx", "**/*.jsx", "**/*.py", "**/*.rs", "**/*.go", "**/*.java", "**/package.json", "**/pyproject.toml"]`
- **Description**: Glob patterns for files that should be analyzed automatically when triggering "Run Extraction". Evaluated using `minimatch`. Files not matching this list will trigger a confirmation prompt before extraction to save tokens.

### `docuvia.extraction.maxLinesWarning`
- **Type**: `number`
- **Default**: `1000`
- **Description**: Show a warning before extracting files larger than this many lines. Encourages the user to use "Add Decision from Selection" for large files instead of sending the entire file to the LLM.

### `docuvia.extraction.maxFileSizeKBWarning`
- **Type**: `number`
- **Default**: `50`
- **Description**: Show a warning before extracting files larger than this size in KB. Acts as a second layer of token-consumption protection alongside line count limits.

### `docuvia.knowledgeGraph.incrementalUpdateThreshold`
- **Type**: `number`
- **Default**: `50`
- **Description**: Maximum number of files modified in a batch before forcing a full Knowledge Graph reload instead of an incremental update.

### `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold`
- **Type**: `number`
- **Default**: `0.5`
- **Description**: Maximum ratio (0.0 to 1.0) of modified files relative to total `.docuvia` files before forcing a full Knowledge Graph reload.
