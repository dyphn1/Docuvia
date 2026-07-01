# Site Reliability Engineering (SRE) Guidelines

## 1. Metrics & Monitoring

- **Instrument Everything**: Expose core metrics for HTTP response times, database query latencies, and background job queue lengths.
- **Error Tracking**: Uncaught exceptions must be reported to centralized logging (e.g., Sentry) with stack traces, request IDs, and context payload. Ensure sensitive PII (Personally Identifiable Information) is redacted before transmission.

## 2. Resilience & Circuit Breaking

- **Fail Gracefully**: External service dependencies (e.g., external LLM providers, 3rd-party APIs) must be wrapped with circuit breakers. If a provider fails continuously, trip the circuit to avoid cascading system failure and return cached or fallback responses.
- **Retry Mechanisms**: Network operations should have exponential backoff and jitter implemented to handle transient faults without overwhelming the downstream services.

## 3. Deployment & CI/CD

- **Zero-Downtime Deployments**: Database schema changes (migrations) must be backward-compatible with the currently running application version. For breaking changes, use a multi-phase deployment (e.g., expand and contract pattern).
- **Automated Rollbacks**: Ensure health checks (`/health` or `/ready`) are in place. If a deployment fails health checks or error rates spike immediately post-deployment, the CI/CD pipeline must automatically rollback to the previous stable version.

## 4. Performance & Scalability

- **Rate Limiting**: Public or highly active API endpoints must implement rate limiting by IP or user token to prevent DoS attacks or noisy neighbor problems.
- **Asynchronous Processing**: Heavy computational tasks (like AST extraction or massive data aggregation) must be offloaded to worker queues (e.g., BullMQ) rather than executing synchronously on the main HTTP request thread.
