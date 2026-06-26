# 03. Security & Risks

**Severity:** 🟠 HIGH
**Affected Docs:** Arc42 Chapter 08, 11, `configuration/settings.md`

The current security design has significant vulnerabilities, especially for a developer tool that directly interacts with source code.

## 1. Plaintext API Key Storage in VS Code
*   **Vulnerability:** `configuration/settings.md` specifies storing `docuvia.server.apiKey` via VS Code settings (which are plaintext JSON).
*   **Proposed Fix:** Must use the VS Code `SecretStorage` API to store credentials securely.

## 2. Unassessed Major Risks (Missing Risks)
*   **Supply Chain Attacks:** If malicious `node_modules` are analyzed or if Prompt Injection occurs via malicious code comments, the system could be manipulated.
*   **Data Loss/Corruption:** No recovery plan if the knowledge graph gets corrupted during synchronization between SQLite and the Git branch.
*   **Toxicity Propagation via AI Hallucination:** If RAG provides incorrect architectural advice and developers blindly adopt it, the entire knowledge graph could be polluted with false information.

## 3. Missing Security Boundaries due to Database-as-IPC
*   **Vulnerability:** As noted in Core Architecture Conflicts, workers write directly to the database. If a worker is compromised, attackers can directly mutate or dump the entire knowledge base.
*   **Proposed Fix:** Consolidate all write privileges behind restricted API endpoints with strict input validation.

## 4. Developer Feedback & Privacy Risks
*   **Vulnerability:** Self-Evolution (ADR-006) captures developer corrections as training data, which could inadvertently collect source code, passwords, or PII (Personally Identifiable Information).
*   **Proposed Fix:** Implement a strict Data Anonymization policy and an explicit Opt-out mechanism.