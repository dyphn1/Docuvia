<!-- docuvia:start -->

# Docuvia — Codebase Knowledge Evolver

This project uses Docuvia to manage architectural context and prevent blast-radius regressions.
Before you explore the codebase (using Grep/Glob/Read) or make structural changes, you MUST query the local knowledge graph:

Run: `npx --no-install docuvia query "<concept_or_file>" --format=prompt`

Use the results from this command to understand architectural boundaries, historical decisions, and potential blast radius before modifying code.
<!-- docuvia:end -->
