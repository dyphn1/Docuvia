# `docuvia hydrate`

Rebuilds the local SQLite database (`local.db`) from the git knowledge branch (`docuvia-knowledge`).

## Usage

```bash
docuvia hydrate
```

## Options

_(This command does not accept any options, arguments, or flags.)_

## Under the Hood

This command ensures that the SQLite database accurately reflects the state stored in the Git branch. It reads the commits from `docuvia-knowledge`, parsing the stored JSON graph structures, and reconstructs the relationships and nodes inside the local SQLite database.

## Examples

Hydrate the local database from the knowledge branch:

```bash
docuvia hydrate
```
