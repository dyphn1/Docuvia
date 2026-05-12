# README.md Template

Use this as a structural guide. Omit sections gracefully when info isn't available.
Write in prose — avoid excessive bullets.

---

```markdown
# {project_name}

> {one_line_description}

<!-- Optional: badges for language, license, CI status -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

{2–4 sentences explaining what the project does, who it's for, and what problem
it solves. Write this as a human would, not a spec sheet.}

## Prerequisites

- {Runtime}: {version} (e.g., Node.js ≥ 20, Python ≥ 3.11)
- {Any other hard requirements}

## Installation

```bash
{package_manager} install
# or: pip install -e .
```

## Usage

```bash
{primary run command}
```

{One-paragraph description of basic usage, or a short example if helpful.}

## Project Structure

```
{abbreviated tree — top-level dirs only, one-line description each}
```

## Development

### Running tests

```bash
{test command}
```

### Linting & formatting

```bash
{lint command}
{format command}
```

### Building

```bash
{build command}
```

## Contributing

{Brief note or link to CONTRIBUTING.md. One or two sentences is enough.}

## License

{License name} — see [LICENSE](LICENSE) for details.
```

---

## Style notes

- Use `##` for top-level sections (not `#`)
- Code blocks must specify language: ` ```bash `, ` ```ts `, etc.
- Don't add sections you can't populate — an empty section is worse than no section
- Keep the Overview honest — don't oversell
- Version numbers must match what's in the config files exactly
