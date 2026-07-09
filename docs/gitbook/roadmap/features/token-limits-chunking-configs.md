# Token Limits & Chunking Configs

- **Status**: ⚠️ WARN
- **Phase**: Phase 5: Local-First VS Code Client & Web UI
- **Evidence / Verification Target**: `artifacts/vscode-client/package.json`

## Implementation Details

The previous Evidence Target (`artifacts/vscode-client/package.json`) does not contain anything related to this feature — its only "token"-related entries are `docuvia.setServerToken`/`docuvia.clearServerToken` (server auth commands), unrelated to LLM token limits or document chunking. There is no `chunkSize`/`maxTokens`-style configuration anywhere in that file. No dedicated token-limit/chunking config surface has been located yet — this feature has not been started; the old evidence link was simply wrong, not stale.

### Component Description

- **Core Logic**: Not yet implemented — no chunking/token-limit configuration surface exists in the codebase as of this audit.
- **State Management**: N/A.

## Testing & Verification

- Run `pnpm test` in the relevant workspace.
- Validate the behavior locally using `docuvia` CLI or the VS Code Extension.
- Check the [Regression & Parity Testing](../../guidelines/regression-and-parity-testing.md) guidelines.
