# Command: Docuvia Run Extraction

## Command Details
- **Command ID**: `docuvia.runExtraction`
- **Title**: `Docuvia: Run L3 Extraction on Active File`
- **Activation Context**: Command Palette, Editor Context Menu (`editorIsOpen`)

## Functional Flow

1. **Context Validation**:
   - Ensure an active text editor is open.
   - Resolve the file path and relative path within the workspace folder.

2. **File Type Filtering**:
   - Reads the `docuvia.extraction.includePatterns` configuration (array of glob patterns).
   - Uses `minimatch` to check if the file matches any included pattern (e.g., `**/*.ts`, `**/package.json`).
   - If it does **not** match, prompt the user with a warning: "This file type is not in your include list. Analyze it anyway?". Can be aborted.

3. **Size Protection**:
   - Reads the `docuvia.extraction.maxLinesWarning` configuration (default 1000).
   - Reads the `docuvia.extraction.maxFileSizeKBWarning` configuration (default 50).
   - If the file's line count exceeds the max lines **OR** the file's byte size exceeds the max KB, prompt the user with a warning: "This file is very large... We recommend selecting a specific block using 'Add Decision from Selection'... Proceed anyway?". Can be aborted.

4. **Task Dispatching**:
   - Creates a `CancellationTokenSource` linked to the task.
   - Enqueues the task via `TaskRunner.queueExtraction` passing the file content, source path, and token.
   - Shows a toast notification: "Extraction task queued. Check Task Queue panel."
