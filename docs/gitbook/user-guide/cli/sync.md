# docuvia-sync(1)

## NAME

docuvia-sync - Sync local knowledge graph changes to a remote server or an orphan branch

## SYNOPSIS

`docuvia sync --local`
`docuvia sync <project_id> [<commit_sha>]`
`echo <commit_sha> | docuvia sync <project_id>`

## DESCRIPTION

The `docuvia sync` command bridges the gap between ephemeral local extractions and durable, team-wide knowledge persistence. It operates in two entirely distinct modes depending on the presence of the `--local` flag.

### Remote Sync Mode (`docuvia sync <project_id>`)

Transmits the locally extracted AST graph, structural diffs, and semantic changes to a central Docuvia API server. This ensures that cross-repository dependencies and team-wide queries can benefit from the knowledge extracted by an individual developer. The sync payload is anchored to the specific Git commit SHA to allow temporal querying.

### Isomorphic Local Sync Mode (`docuvia sync --local`)

Acts as an offline-first mechanism to store the knowledge graph directly within the Git repository itself. It extracts the AST, maps it to a proprietary Markdown/JSON event format, and packs it into a Git orphan branch named `docuvia-knowledge`. By pushing this branch alongside your standard code branches (`git push origin docuvia-knowledge`), the repository's knowledge travels natively with the code.

## OPTIONS

`--local`
: Execute the offline isomorphic sync. Bypasses all network requests and packages the AST into the `docuvia-knowledge` branch within the local Git tree.

`<project_id>`
: The UUID or namespace ID of the remote Docuvia project. Required if `--local` is omitted.

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

Pack the knowledge graph locally before pushing a feature branch:

```bash
$ docuvia sync --local
[docuvia] Running local AST sync...
[docuvia] Successfully packed local knowledge to branch. Nodes: 450, Links: 890
$ git push origin docuvia-knowledge
```

Sync knowledge securely to the central API server in a CI pipeline:

```bash
$ export DOCUVIA_API_URL="https://docuvia.mycompany.com"
$ export MCP_PAT="secret-token"
$ echo $GITHUB_SHA | docuvia sync proj_12345
Successfully synced knowledge graph to server for commit e8f4a3...
```

## SEE ALSO

- [docuvia-analyze(1)](analyze.md) - Generate the AST data before syncing.
