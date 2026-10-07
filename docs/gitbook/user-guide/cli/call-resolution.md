# `docuvia call-resolution quarantine`

Manage workspace-local quarantines for strict Tier B call-resolution rules. A quarantine suppresses the rule's fast path after a valid Tier B contradiction. Clearing it restores the ordinary path, including the canary; a new contradiction can quarantine the signature again.

## Usage

```bash
docuvia call-resolution quarantine list
docuvia call-resolution quarantine clear <rule-signature> \
  --artifact=certification.json --trusted-inputs=trusted-inputs.json
docuvia call-resolution quarantine clear <rule-signature> \
  --operator='name or identifier' --reason='reviewed rule implementation change'
```

`list` displays active quarantines, their captured configuration hashes, and clear audit history. Legacy quarantines without a captured hash are marked `unknown (legacy)` and cannot be cleared.

`clear` prints a preview containing the quarantine, prior and current configuration hashes, evidence summary, and operator/reason before attempting the change. Exactly one evidence mode is required:

- **Certification:** `--artifact` points to the certification decision and `--trusted-inputs` points to the trusted expected-input JSON used by the certification loader. Both files must be regular files inside the workspace and no larger than 4 MiB. The loader validates the trusted pin, provenance, and both certification tracks. The inputs must pin the current rule-configuration SHA-256; the passed signature must have a valid decision; and the results timestamp must be newer than the quarantine.
- **Operator:** `--operator` and `--reason` record who authorized the clear and why. This path is an explicit attestation, not a certification result. It still requires the current rule-configuration hash to differ from the quarantine's recorded hash.

Both paths fail closed if there is no matching active quarantine, the rule configuration has not changed, or the evidence is invalid or stale. A successful clear adds an immutable audit record and removes the active quarantine atomically. Repeating a successful clear is idempotent.

See [Tiered Call Resolution Quarantine Recertification](../../analysis/tiered-call-resolution-quarantine-recertification.md) for lifecycle details.
