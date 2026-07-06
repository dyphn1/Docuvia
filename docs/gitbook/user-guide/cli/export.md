# docuvia export --topology

The `docuvia export --topology` command reads the local knowledge graph (L2 nodes, relationships, L3 decisions, and L1 tags as groups) from `.docuvia/local.db` and generates a machine-readable JSON file alongside an interactive HTML visualizer.

## What it does

Instead of relying on a server to render your code architecture, this command exports the data into a **fully self-contained, offline HTML file** (`topology.html`). You can open this file in any modern web browser to visually explore the structure of your codebase, check node dependencies, and interactively browse the blast radius of potential changes.

The command also generates `topology.json`, which contains the versioned schema data for machine or API consumption.

## Usage

```bash
docuvia export --topology [flags]
```

### Options & Flags

| Flag                | Description                                                                                                                                                                                   |
| :------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--out=<DIR>`       | Specifies the output directory. Defaults to the `.docuvia/` folder in the workspace root.                                                                                                     |
| `--json`            | Skips generating the `topology.html` file and only writes `topology.json`. Useful for CI/CD pipelines or headless agent ingestion.                                                            |
| `--collapse=<mode>` | Controls how nodes are collapsed if the graph is too large. Valid modes: `file`, `symbol`, or `auto` (defaults to auto-folding symbols into files when the node count exceeds the threshold). |

## Examples

**Export topology to the default `.docuvia` directory:**

```bash
docuvia export --topology
```

_Outputs: `.docuvia/topology.json` and `.docuvia/topology.html`._

**Export only the machine-readable JSON file to a custom folder:**

```bash
docuvia export --topology --json --out=./build/exports
```

**Force the graph to collapse into file-level nodes (hiding individual functions/classes):**

```bash
docuvia export --topology --collapse=file
```

## Exploring the HTML View

When you open `topology.html` in your browser:

- **Pan and Zoom:** Click and drag the background to pan. Use the mouse wheel or the provided **+ / − / Fit View** controls to zoom.
- **Node Info:** Click on any node to view its details (type, degree, file path, tags) in the sidebar.
- **Blast Radius:** Click the selected node a second time to highlight its blast radius (upstream dependent nodes) up to a depth of 3.
- **Legend:** Click on groups in the legend to toggle their visibility in the graph.
- **Decision Nodes:** L3 decision nodes are rendered as square blocks instead of circles, clearly highlighting architecture or design records bound to the structural code elements.
