# Verification Report: Git Ingestion (Command Injection & SSRF)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 2 - Git Ingestion
- **Target File**: artifacts/api-server/src/routes/ingest.ts, artifacts/api-server/src/lib/git-client.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
*   **Argument Injection (Command Execution):** Yes. In `ingest.ts`, `repoUrl` and `branch` are taken directly from the request body and passed to `LocalGitClient.clone()`, which calls: `execFileAsync("git", ["clone", "--depth=500", "--branch", branch, this.repoUrl, this.repoDir])`. Because `git clone` options and positional arguments are not separated by `--`, an attacker can pass a `repoUrl` or `branch` starting with a hyphen (e.g., `--upload-pack=bash -c 'malicious_cmd'`) to hijack the git execution and achieve arbitrary command execution on the server.
*   **SSRF (Server-Side Request Forgery) & Arbitrary File Read:** Yes. The Git ingestion route lacks any URL scheme validation. An attacker can supply a `file:///etc/passwd` (or other sensitive paths) to force the server to read local files, or provide internal network URLs (e.g., `http://169.254.169.254/` or `http://localhost:8080`) to map the internal network. *(Note: The SVN ingestion route explicitly checks for `^https?:\/\/|^svn:\/\/`, but still fails to protect against internal IP SSRF).*

### Recommended Fix
Fix Git Argument Injection by adding the `--` separator before positional arguments in `git-client.ts`. Fix SSRF by implementing strict URL validation for `repoUrl` (and `svnUrl`), enforcing `http://` or `https://` schemes, and rejecting private/internal IP ranges (e.g., `10.0.0.0/8`, `127.0.0.1`, `169.254.169.254`).
