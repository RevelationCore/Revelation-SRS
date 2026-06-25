#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-RevelationCore/Revelation-SRS}"
BRANCH="${BRANCH:-main}"
MACHINE="${MACHINE:-standardLinux32gb}"
DISPLAY_NAME="${DISPLAY_NAME:-revelation-srs-demo}"
IDLE_TIMEOUT="${IDLE_TIMEOUT:-30m}"
RETENTION_PERIOD="${RETENTION_PERIOD:-12h}"
DEVCONTAINER_PATH="${DEVCONTAINER_PATH:-.devcontainer/demo/devcontainer.json}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required. Install it from https://cli.github.com/ and run 'gh auth login'."
  exit 1
fi

echo "Creating Codespace demo:"
echo "  repo:             ${REPO}"
echo "  branch:           ${BRANCH}"
echo "  machine:          ${MACHINE}"
echo "  idle timeout:     ${IDLE_TIMEOUT}"
echo "  retention period: ${RETENTION_PERIOD}"
echo

gh codespace create \
  --repo "${REPO}" \
  --branch "${BRANCH}" \
  --devcontainer-path "${DEVCONTAINER_PATH}" \
  --machine "${MACHINE}" \
  --display-name "${DISPLAY_NAME}" \
  --idle-timeout "${IDLE_TIMEOUT}" \
  --retention-period "${RETENTION_PERIOD}"

echo
echo "Codespace requested. Open it from GitHub, then use the Ports tab for the Admin and Portal URLs."
