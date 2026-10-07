# Tiered Call Resolution Quarantine Recertification

Quarantines are local runtime state. A Tier B contradiction removes a rule signature's permission to skip verification; it does not change portable graph truth. The quarantine remains active until an explicit clear succeeds.

The current rule-configuration SHA-256 is a canonical manifest of the strict-proof rule version and supported signatures. Any change to strict-proof implementation or rule configuration must update that versioned manifest. A clear is rejected unless its new hash differs from the hash captured when the signature was quarantined. Legacy rows with no captured hash remain fail-closed because their prior configuration cannot be established.

There are two clear paths:

- **Certification:** provide a certification artifact and its trusted expected-input manifest. The existing certification loader must accept its trusted pin and provenance and pass both independent tracks for the same signature. The inputs must identify the current rule-configuration hash, and the recorded results timestamp must be strictly newer than the active quarantine.
- **Operator:** record an operator identity and reason. This is an explicit attestation, not certification; it still requires the current rule-configuration hash to differ and the clear time to be newer than the quarantine.

Each successful clear stores a durable audit snapshot of the quarantine, clear time, previous and new hashes, and evidence hash or operator/reason, then removes the active quarantine in the same transaction. Repeating a clear after it succeeds is idempotent. A later contradiction creates a new active quarantine, so the usual canary and Tier B verification path still applies after recertification. Time passing or a lack of new contradictions never clears state.

The CLI entry point and examples are documented in [`docuvia call-resolution`](../user-guide/cli/call-resolution.md). The Q1 candidate certification artifact is not loaded by this runtime path.
