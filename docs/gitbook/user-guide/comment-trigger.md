# Comment-Triggered Analysis

Docuvia supports **PR comment-triggered analysis** via GitHub Actions. When you post a `/docuvia` command as a comment on a Pull Request, the corresponding analysis runs in CI and results are posted back as a PR comment.

## Prerequisites

- The repository must have the `.github/workflows/comment-trigger.yml` workflow (shipped with Docuvia ≥ 1.4.0).
- The commenter must have **write access** to the repository (OWNER, MEMBER, or COLLABORATOR association).
- The pull request must come from a **branch in this repository**, not a fork — see [Security](#security).

## Available Commands

| Command                    | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `/docuvia analyze`         | Run full AST analysis on the PR diff              |
| `/docuvia review`          | Run blast-radius review against the base branch   |
| `/docuvia impact <symbol>` | Run impact analysis for a specific symbol or file |
| `/docuvia query <concept>` | Query the knowledge graph for a concept or file   |
| `/docuvia status`          | Show current knowledge graph status               |

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
2. Only PR comments starting with `/docuvia` are processed.
3. The `dispatch` job parses the command, validates the argument, checks the commenter's
   write access, refuses fork PRs, and resolves the PR head SHA through the pulls API.
4. It acknowledges with a comment linking to the run.
5. The `run` job checks out that head SHA, builds, ingests the tree, and executes the command.
6. Results are posted back as a PR comment.

> **Why the head SHA comes from the API.** The `issue_comment` payload's
> `issue.pull_request` object contains only `url`, `html_url`, `diff_url`, `patch_url`
> and `merged_at`. There is no `head.sha` on it, so reaching for
> `github.event.issue.pull_request.head.sha` yields an empty string and
> `actions/checkout` silently falls back to the default branch — analyzing `main`
> and reporting it as the PR's result. The head SHA must be fetched with
> `github.rest.pulls.get`.

## Security

- **Write access required**: only OWNER, MEMBER, or COLLABORATOR can trigger a command.
- **Fork pull requests are refused.** These commands check out the PR head and execute its
  code (`pnpm install` lifecycle scripts, `pnpm run build`) using a token scoped
  `pull-requests: write`. The write-access check applies to whoever _commented_, never to
  whoever _authored_ the PR — so without this second gate an outsider could open a fork PR
  carrying a malicious `postinstall` and wait for a collaborator to type `/docuvia review`.
  Same-repo branches are safe because only someone with push access can create one.
- **Comment text never reaches a shell as code**: arguments are matched against
  `^[A-Za-z0-9 _./#@:-]{1,200}$` and passed to the CLI through environment variables.
  `${{ }}` expressions are substituted _before_ bash parses the script, so quoting alone
  cannot contain a hostile value — `$VAR` expansion can.
- **Scoped permissions**: `GITHUB_TOKEN` with `contents: read` and `pull-requests: write`.
- **Concurrency control**: one analysis per PR at a time; new commands cancel in-progress runs.

## Output formats

`review`, `impact` and `query` support `--format=json` and are rendered as tables. `analyze`
and `status` have no `--format` flag — their human-readable output is posted verbatim in a
plain code block rather than mislabelled as JSON.

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
