#!/usr/bin/env sh
set -eu

if command -v make >/dev/null 2>&1; then
  make check
else
  npm run check
fi

test -f dist/connect-callback.html
test -f dist/connectCallback.js

node <<'EOF'
const fs = require('fs')

const manifest = JSON.parse(fs.readFileSync('dist/manifest.json', 'utf8'))
const requiredOrigins = [
  'https://meet2note.com/*',
  'http://localhost/*',
  'http://127.0.0.1/*'
]

function assertArrayIncludesAll(arrayValue, requiredValues, fieldName) {
  if (!Array.isArray(arrayValue)) {
    console.error(`dist/manifest.json is missing ${fieldName} array`)
    process.exit(1)
  }

  for (const value of requiredValues) {
    if (!arrayValue.includes(value)) {
      console.error(`dist/manifest.json is missing ${fieldName} entry: ${value}`)
      process.exit(1)
    }
  }
}

assertArrayIncludesAll(manifest.host_permissions, requiredOrigins, 'host_permissions')

if (!Array.isArray(manifest.web_accessible_resources)) {
  console.error('dist/manifest.json is missing web_accessible_resources array')
  process.exit(1)
}

const callbackResource = manifest.web_accessible_resources.find((entry) =>
  Array.isArray(entry.resources) && entry.resources.includes('connect-callback.html')
)

if (!callbackResource) {
  console.error('dist/manifest.json is missing connect-callback.html web accessible resource')
  process.exit(1)
}

assertArrayIncludesAll(callbackResource.matches, requiredOrigins, 'connect-callback.html matches')
EOF
