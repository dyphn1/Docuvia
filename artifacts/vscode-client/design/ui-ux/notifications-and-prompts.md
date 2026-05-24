# UI/UX: Notifications & Prompts

## Toast Notifications
We use VS Code's native `vscode.window.showInformationMessage`, `showWarningMessage`, and `showErrorMessage` to provide feedback.

**Guidelines:**
- **Prefixing**: All toast messages must start with `Docuvia: ` to clearly identify the source of the notification.
- **Errors**: Provide actionable advice when possible. Example: `"Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."`
- **Success/Info**: Keep it brief and non-intrusive. Example: `"Docuvia: Extraction task queued."`
- **Warnings**: Use for recoverable edge cases, such as file size warnings before extraction. 

## QuickPicks & Input Boxes
Used for gathering user input without blocking the entire window.

**Guidelines:**
- **Placeholders**: Always provide a meaningful `placeHolder` to guide the user (e.g., `e.g. how do other projects handle auth`).
- **Input Validation**: Validate inputs where possible and use `validateInput` to show inline error messages before the user submits.
- **Unobtrusive**: Avoid prompting unnecessarily. If context can be derived automatically (e.g., active editor's workspace folder or selected text), use it instead of prompting.
- **Action Items**: When presenting a list of choices (e.g., L2 Modules), always include a clear fallback or creation action (e.g., `$(add) Create new module later... (unassigned)`).

## Destructive Actions
- **Explicit Confirmation**: Use explicit warnings (e.g., via `showWarningMessage` with "Overwrite" / "Cancel" buttons) before performing destructive actions like overwriting initialized `.docuvia` folders. Never overwrite user data silently.