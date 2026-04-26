#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
RELEASE_DIR="${ROOT_DIR}/release"

if [ ! -d "${DIST_DIR}" ]; then
  echo "dist/ not found. Run make build first." >&2
  exit 1
fi

if [ ! -f "${DIST_DIR}/manifest.json" ]; then
  echo "dist/manifest.json not found. Run make build first." >&2
  exit 1
fi

SOURCE_VERSION="$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")"
DIST_VERSION="$(python3 -c "import json; print(json.load(open('dist/manifest.json'))['version'])")"

if [ "${SOURCE_VERSION}" != "${DIST_VERSION}" ]; then
  echo "Version mismatch between manifest.json (${SOURCE_VERSION}) and dist/manifest.json (${DIST_VERSION}). Rebuild before packaging." >&2
  exit 1
fi

PACKAGE_NAME="meet2note-chrome-extension-v${SOURCE_VERSION}.zip"
PACKAGE_PATH="${RELEASE_DIR}/${PACKAGE_NAME}"

mkdir -p "${RELEASE_DIR}"
rm -f "${PACKAGE_PATH}"

(
  cd "${DIST_DIR}"
  zip -qr "${PACKAGE_PATH}" .
)

echo "${PACKAGE_PATH}"
