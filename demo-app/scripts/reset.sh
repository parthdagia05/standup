#!/usr/bin/env bash
# Put the demo repo back to its starting state between takes.
set -euo pipefail
cd "$(dirname "$0")/.."
git checkout -- .
git clean -fd -e node_modules
npm install --silent
echo "demo-app reset"
