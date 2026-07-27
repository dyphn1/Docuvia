# `docuvia sync-knowledge`

Fetches, merges, and pushes the knowledge branch (`docuvia-knowledge`) across clones to enable team sharing.

## Usage

```bash
docuvia sync-knowledge
```

## Options

_(This command does not accept positional arguments.)_

### Flags

- `DOCUVIA_PUSH_TIMEOUT_MS` _(Environment Variable)_: Overrides the timeout (in milliseconds) bounding the underlying `git fetch`/`git push` of the knowledge branch. Unset by default, meaning no timeout at all. Set this only if you want sync-knowledge to fail fast instead of waiting on a stalled remote.

## Under the Hood

Unlike the `sync` command which pushes L3 decisions to the remote API server, `sync-knowledge` reconciles the actual `docuvia-knowledge` Git branch between developers' machines via the Git remote. It handles fetching changes, merging diverged histories locally, and pushing the reconciled graph back to the remote repository.

## Examples

Reconcile the local knowledge branch with the remote:

```bash
docuvia sync-knowledge
```
