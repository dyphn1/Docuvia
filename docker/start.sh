#!/bin/bash
set -e

echo "Running DB migrations..."
pnpm --filter @workspace/db run migrate

echo "Starting Nginx..."
nginx

echo "Starting API Server..."
pnpm --filter @workspace/api-server run start
