# 02. Missing Designs & ADRs

**Severity:** 🟡 MEDIUM
**Affected Docs:** Arc42 Chapter 03, 06, 07, ADR-009, Missing ADRs

While the current architecture covers RAG and core graph flows, it severely lacks designs for standard enterprise infrastructure and edge case scenarios.

## 1. Missing Critical ADRs
*   **Authentication & Authorization (Auth/RBAC):** No mechanisms defined for API Keys, JWT, or OAuth. No role-based access control (RBAC).
*   **Multi-Tenancy:** Does the API server support sharing across multiple projects/teams? What is the data isolation strategy?
*   **Caching Strategy:** Cache invalidation and warming mechanisms are undefined.
*   **Error Handling:** Missing definitions for retry policies, Circuit Breakers, and Dead Letter Queues (DLQ).
*   **CI/CD Pipeline:** Deployment automation and database migration automation are not defined.

## 2. Lack of High Availability (HA) and Disaster Recovery (DR)
*   **Issue:** Arc42 Chapter 10 requires 99.9% availability, but Chapter 07 only provides a single-node Docker Compose setup for development.
*   **Proposed Fix:**
    *   Design automated backups (S3 Snapshots) and failover for PostgreSQL.
    *   Define a stateless design for the API server and a Load Balancer deployment strategy.
    *   Define Recovery Point Objective (RPO) and Recovery Time Objective (RTO).

## 3. Token Budget Lacks Concrete Implementation
*   **Issue:** ADR-009 proposes Token Management but lacks specific numbers, interruption mechanisms when quotas are exhausted, and billing tracking.
*   **Proposed Fix:** Introduce a Two-Phase Ingestion estimation (calculate tokens before execution) and a circuit breaker mechanism (Rate Limiter).

## 4. Missing Runtime Scenarios
*   **Issue:** Arc42 Chapter 06 only documents "Happy Paths".
*   **Missing Scenarios:**
    *   Syncing from offline operation back to online.
    *   Handling LLM API timeouts or malformed responses.
    *   Race conditions in concurrent ingestions.
    *   Auth login and authorization flows.