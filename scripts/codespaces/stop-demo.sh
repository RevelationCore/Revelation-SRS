#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash scripts/codespaces/stop-demo.sh <codespace-name>"
  echo
  echo "Find the name with:"
  echo "  gh codespace list"
  exit 1
fi

gh codespace stop --codespace "$1"
