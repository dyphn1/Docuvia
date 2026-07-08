#!/bin/sh
# Docuvia post-push hook
# Install: git config core.hooksPath .githooks

# Replace YOUR_PROJECT_ID with your actual Docuvia project ID
PROJECT_ID="YOUR_PROJECT_ID"
COMMIT_SHA=$(git rev-parse HEAD)

docuvia sync "$PROJECT_ID" "$COMMIT_SHA"
