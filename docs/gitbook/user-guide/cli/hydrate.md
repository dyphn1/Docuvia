# docuvia hydrate

**Status: Available**

Rebuilds the `local.db` database from the knowledge branch (`docuvia-knowledge`). This is the reverse operation of `docuvia snapshot` and is part of the Git-native round trip.

## Usage

```bash
docuvia hydrate
```

## Description

This command ensures that the SQLite database accurately reflects the state stored in the Git branch. It reads the commits from `docuvia-knowledge`, parsing the stored JSON graph structures, and reconstructs the relationships and nodes inside the local SQLite database.
