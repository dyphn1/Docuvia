# Knowledge Graph Cross-Project Search

## Settings & Configuration
- **Setting**: `docuvia.search.defaultView`
- **Values**: `chat` (default) or `webview`
- **Description**: Determines where search results are displayed when the user triggers a search.

## Commands

### `docuvia.openSearch`
- Triggered via Command Palette or view title icon.
- Prompts the user with an input box: "Search cross-project knowledge".
- Triggers the underlying `executeSearch` flow.

### `docuvia.searchFromSelection`
- Triggered via Editor Right-Click Context Menu.
- Condition: `editorHasSelection`
- Takes the highlighted text and passes it directly into the `executeSearch` flow without prompting.

## `executeSearch` Flow
1. Evaluates the `docuvia.search.defaultView` setting.
2. **If `chat`**:
   - Programmatically executes `workbench.action.chat.open` with the query prefilled as `@docuvia /query <user_query>`.
   - Delegates the display and interaction to the Copilot Chat UI.
   - *Technical Note*: Due to limitations in the current VS Code Chat API, this command can only prefill the chat input box. **The user must manually press Enter** to submit the query.
3. **If `webview`**:
   - Makes an API call to the Central Server via `centralClient.query(query)`.
   - On success, opens or updates the `SearchResultsPanel` (Webview).
   - Handles `CentralServerAuthError` by prompting the user to run `Docuvia: Set Server Token`.
