#!/usr/bin/env sh
set -eu

if command -v make >/dev/null 2>&1; then
  make check
else
  npm run check
fi

test -f dist/connect-callback.html
test -f dist/connectCallback.js
grep -q 'connect-callback.html' dist/manifest.json
grep -F -q 'https://meet2note.com/*' dist/manifest.json
