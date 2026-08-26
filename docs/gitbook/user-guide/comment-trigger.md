# Comment-Triggered Analysis

Docuvia supports **PR comment-triggered analysis** via GitHub Actions. When you post a `/docuvia` command as a comment on a Pull Request, the corresponding analysis runs in CI and results are posted back as a PR comment.

## Prerequisites

- The repository must have the `.github/workflows/comment-trigger.yml` workflow (shipped with Docuvia ≥ 1.4.0).
- The commenter must have **write access** to the repository (OWNER, MEMBER, or COLLABORATOR association).

## Available Commands

| Command | Description |
|---------|-------------|
| `/docuvia analyze` | Run full AST analysis on the PR diff |
| `/docuvia review` | Run blast-radius review against the base branch |
| `/docuvia impact <symbol>` | Run impact analysis for a specific symbol or file |
| `/docuvia query <concept>` | Query the knowledge graph for a concept or file |
| `/docuvia status` | Show current knowledge graph status |

## Usage

1. Open a Pull Request (or navigate to an existing one).
2. Post a comment starting with `/docuvia` followed by the command.
3. Wait for the workflow to complete (usually 2-5 minutes).
4. The results will be posted as a new PR comment.

### Examples

```
/docuvia analyze
```

Triggers a full analysis of the PR's changed files against the knowledge graph.

```
/docuvia review
```

Runs blast-radius analysis comparing the PR head to the base branch, showing risk level and affected graph nodes.

```
/docuvia impact calculateBlastRadius
```

Shows all dependents of the `calculateBlastRadius` symbol across the codebase.

```
/docuvia query blast-radius
```

Queries the knowledge graph for concepts related to "blast-radius".

```
/docuvia status
```

Displays the current state of the knowledge graph (ingested SHA, node counts, etc.).

## How It Works

1. The `comment-trigger.yml` workflow listens for `issue_comment` (created) events.
2. Only PR comments matching `/docuvia` are processed.
3. The workflow validates the commenter has write access.
4. A parsing step extracts the command and arguments.
5. The appropriate analysis job runs in a fresh CI environment.
6. Results are posted back as a PR comment.

## Security

- **Write access required**: Only users with OWNER, MEMBER, or COLLABORATOR association can trigger analysis.
- **Scoped permissions**: The workflow uses `GITHUB_TOKEN` with `contents: read` and `pull-requests: write`.
- **No secrets exposed**: Comment content is never interpolated into shell commands (uses GitHub Script for parsing).
- **Concurrency control**: Only one analysis runs per PR at a time; new commands cancel in-progress runs.

## Troubleshooting

### "Insufficient permissions" error

Your GitHub association must be OWNER, MEMBER, or COLLABORATOR. Check your role in the repository settings.

### Workflow doesn't trigger

- Ensure the comment starts with `/docuvia` (case-insensitive command).
- Ensure the comment is on a Pull Request, not a regular issue.
- Check the Actions tab for the workflow run.

### Analysis fails

The workflow output includes stderr logs. Common causes:
- Missing dependencies (the workflow installs and builds automatically).
- Knowledge graph initialization failure (check if `docuvia init` works locally).
