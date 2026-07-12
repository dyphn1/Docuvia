# docuvia sync-knowledge

**Status: Available**

Fetches, merges, and pushes the knowledge branch (`docuvia-knowledge`) across clones to enable team sharing.

## Usage

```bash
docuvia sync-knowledge
```

## Description

Unlike the `sync` command which pushes L3 decisions to the remote API server, `sync-knowledge` reconciles the actual `docuvia-knowledge` Git branch between developers' machines via the Git remote. It handles fetching changes, merging diverged histories locally, and pushing the reconciled graph back to the remote repository.
