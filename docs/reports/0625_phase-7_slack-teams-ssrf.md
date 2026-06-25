# Verification Report: Slack / Teams bot (SSRF)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 7 - Slack / Teams bot
- **Target File**: artifacts/api-server/src/lib/slack-teams-client.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
Both `postSlackMessage` and `postTeamsMessage` execute a raw `fetch(webhookUrl, ...)` based on URLs pulled from the `projectIntegrationsTable`. There is no validation on the user-supplied `webhookUrl` to ensure it is actually pointing to `hooks.slack.com` or `*.webhook.office.com`.

A malicious user can configure a project integration with a webhook URL pointing to an internal IP address or cloud metadata endpoint (e.g., `http://169.254.169.254/latest/meta-data/` on AWS, or `http://localhost:8080/admin/shutdown`). When an event triggers, the Node.js server blindly sends a `POST` request to that internal address, enabling Blind SSRF network scanning or execution of internal unauthorized requests.

### Recommended Fix
Implement a strict URL schema and domain validation using Zod (`z.string().url().regex(/hooks\.slack\.com/i)`) on the integration creation endpoint, and use an SSRF-prevention library/agent during the `fetch` call that resolves the DNS and blocks local, loopback, and private IP CIDR ranges at the network level.
