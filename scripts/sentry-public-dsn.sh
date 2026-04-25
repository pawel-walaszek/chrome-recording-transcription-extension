#!/bin/sh
set -eu

secrets_file="${CODEX_SECRETS:-$HOME/.codex/.secrets}"

if [ -f "$secrets_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$secrets_file"
  set +a
fi

if [ -n "${SENTRY_DSN:-}" ]; then
  printf '%s\n' "$SENTRY_DSN"
  exit 0
fi

if [ -z "${SENTRY_AUTH_TOKEN:-}" ] ||
   [ -z "${SENTRY_ORG_SLUG:-}" ] ||
   [ -z "${SENTRY_PROJECT_SLUG:-}" ] ||
   [ -z "${SENTRY_BASE_URL:-}" ]; then
  exit 0
fi

api_base="${SENTRY_BASE_URL%/}"
case "$api_base" in
  */api/0) ;;
  *) api_base="$api_base/api/0" ;;
esac

curl -fsS \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "$api_base/projects/$SENTRY_ORG_SLUG/$SENTRY_PROJECT_SLUG/keys/" |
  python3 -c 'import json, sys
keys = json.load(sys.stdin)
if not keys:
    sys.exit(0)
dsn = keys[0].get("dsn", {})
print(dsn.get("public") or dsn.get("publicDsn") or "")'
