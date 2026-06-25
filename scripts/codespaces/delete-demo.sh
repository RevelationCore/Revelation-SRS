#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash scripts/codespaces/delete-demo.sh <codespace-name>"
  echo
  echo "Find the name with:"
  echo "  gh codespace list"
  exit 1
fi

gh codespace delete --codespace "$1" --force
