# `docuvia export`

The `export` command generates static artifacts from the SQLite knowledge graph. The primary use case is generating an offline interactive topology map.

## Usage

```bash
docuvia export --topology
```

### Flags

- `--topology` _(Required)_: Generates an interactive HTML/JS topology map of the codebase.

## Under the Hood

When you run `docuvia export --topology`:

1. **Read-Side Query**: The system queries the `IGraphNodesRepo` to fetch `getAllNodes` and `getAllLinks`.
   > _Warning: In massive codebases, this loads the entire graph into memory, which carries an Out-Of-Memory (OOM) risk._
2. **Cross-Project Linking**: It reads any global L1 tags to map boundaries.
3. **Artifact Generation**: It outputs an HTML bundle (typically to `.docuvia/exports/topology.html`) that can be opened in any browser to explore the architectural graph visually.
4. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/export.log`.

## Examples

Export the topology map:

```bash
docuvia export --topology
```
