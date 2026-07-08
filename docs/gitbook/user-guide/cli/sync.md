# docuvia-sync(1)

## NAME

docuvia-sync - Sync local knowledge graph changes to a remote server

## SYNOPSIS

`docuvia sync [<project_id>] [<commit_sha>]`

## DESCRIPTION

The `docuvia sync` command bridges the gap between ephemeral local extractions and durable, team-wide knowledge persistence. It transmits the locally extracted AST graph, structural diffs, and semantic changes to a central Docuvia API server. This ensures that cross-repository dependencies and team-wide queries can benefit from the knowledge extracted by an individual developer. The sync payload is anchored to the specific Git commit SHA to allow temporal querying.

If the `<project_id>` or `<commit_sha>` arguments are omitted, the CLI will enter a wizard-style interactive prompt to guide the user to select the appropriate project ID from the local database.

## OPTIONS

`<project_id>`
: The UUID or namespace ID of the remote Docuvia project. If omitted, an interactive prompt will appear.

`<commit_sha>`
: (Optional) The specific Git commit SHA to anchor the synchronized knowledge against. If omitted and running in an interactive terminal, the command attempts to resolve `HEAD`. It can also be passed securely via `stdin`.

## ENVIRONMENT VARIABLES

`DOCUVIA_API_URL`
: The absolute URL to the central Docuvia server (e.g., `https://api.docuvia.internal`). Required for remote sync.

`MCP_PAT`
: The Personal Access Token for authentication against the Docuvia server. Required for remote sync.

## EXIT STATUS

**0**
Success. Knowledge graph pushed to the remote server or packed to the orphan branch successfully.

**1**
Failure. Network error, missing environment variables, or Git tree manipulation failed.

## EXAMPLES

Sync knowledge securely to the central API server in a CI pipeline:

```bash
$ export DOCUVIA_API_URL="https://docuvia.mycompany.com"
$ export MCP_PAT="secret-token"
$ echo $GITHUB_SHA | docuvia sync proj_12345
Successfully synced knowledge graph to server for commit e8f4a3...
```

## SEE ALSO

- [docuvia-analyze(1)](analyze.md) - Generate the AST data before syncing.
- [docuvia-snapshot(1)](snapshot.md) - Pack the local graph to an offline Git orphan branch.
