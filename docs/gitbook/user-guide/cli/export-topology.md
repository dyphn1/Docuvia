# `docuvia export-topology`

The `export-topology` command generates static topological representations of the SQLite knowledge graph. It generates a detailed JSON representation and an offline interactive HTML/JS topology map.

## Usage

```bash
docuvia export-topology [flags]
```

## Options

_(This command does not accept positional arguments.)_

### Flags

- `--out=<path>`: Override the output directory path. Defaults to `<workspaceRoot>/.docuvia/`.
- `--json-only`: Writes only the `topology.json` file and skips the HTML topology viewer generation.
- `--collapse=<all|modules|files>`: Collapse specific structural types to fold/simplify the exported graph.

## Under the Hood

When you run `docuvia export-topology`:

1. **Read-Side Query**: The system queries the `IGraphNodesRepo` to fetch `getAllNodes` and `getAllLinks`.
2. **Cross-Project Linking**: It reads global L1 tags to map boundaries.
3. **Artifact Generation**: It outputs `topology.json` and optionally `topology.html` to the designated output folder (typically `.docuvia/`). The HTML file contains an offline interactive D3.js visualization which can be opened in any web browser to explore the architectural graph.
4. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/export.log`.

## Examples

Export the topology map to default `.docuvia/` folder:

```bash
docuvia export-topology
```

Export only JSON representation to a custom directory:

```bash
docuvia export-topology --out=./exports --json-only
```

Export and collapse modules:

```bash
docuvia export-topology --collapse=modules
```
