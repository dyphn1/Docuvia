#!/bin/sh
# Docuvia post-push hook
# Install: git config core.hooksPath .githooks
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMITS=$(git log @{u}..HEAD --format=%H | tr '\n' ',')
docuvia sync --branch "$BRANCH" --commits "$COMMITS"
