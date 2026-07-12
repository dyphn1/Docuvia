# docuvia doctor

Diagnoses Git sync issues, remote reachability, and SQLite health to provide a transparent system status.

## Usage

```bash
docuvia doctor
```

### Flags

All checks run by default. Skip the ones you don't need — useful when offline or when a check is known-flaky in your environment:

- `--skip-db`: Skip the SQLite integrity check.
- `--skip-git`: Skip the Git remote reachability check.
- `--skip-hooks`: Skip the integration hook presence check.
- `--skip-logs`: Skip the `.docuvia/logs/*.log` analysis.

## Description

Provides an isolated, fast health check for the environment to determine why network or storage operations might be failing.

### Health Checks

1. **SQLite Integrity (Storage)**: Runs `PRAGMA integrity_check` against `.docuvia/local.db`.
2. **Git Network Status (Network)**: Performs a remote reachability test with a strict **5000ms timeout** to prevent `libgit2` from hanging indefinitely on bad connections or SSH prompts.
3. **Integration Hooks (Hooks)**: Verifies that the Claude/Cursor hook files installed by `docuvia init` are present.
4. **Log Analysis (Logs)**: Parses `.docuvia/logs/*.log` files to surface any critical errors directly.

## Examples

Run every check:

```bash
docuvia doctor
```

Skip the network check when working offline:

```bash
docuvia doctor --skip-git
```
