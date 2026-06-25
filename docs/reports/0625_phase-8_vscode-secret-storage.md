# Verification Report: Item 9.1.2 — API Key via VS Code SecretStorage
- **Date**: 2026-06-25
- **Phase & Item**: Phase 8 - Vscode Secret Storage
- **Target File**: Unknown (Derived from audit)
- **Status Update Required**: ❌ ERROR / ⚠️ WARN

### Description of Failure
5. **🟡 MEDIUM — Token sent as custom header over HTTPS assumed**: The `x-docuvia-token` header is a custom authentication scheme. The `server_url` in `~/.docuvia/config.yaml` is documented as requiring `https://` (per `settings.md` line 60: "Must use `https://`"). However, there is no runtime validation that the URL uses HTTPS. If a user configures `http://` instead of `https://`, the token would be transmitted in cleartext.
   - **Mitigation**: The design doc mandates HTTPS. The risk is low sin...

### Recommended Fix
Review the warnings and implement fixes in the corresponding source files.
