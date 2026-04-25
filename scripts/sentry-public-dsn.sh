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

if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' 'sentry-public-dsn.sh: missing required dependency: curl' >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'sentry-public-dsn.sh: missing required dependency: python3' >&2
  exit 1
fi

api_base="${SENTRY_BASE_URL%/}"
case "$api_base" in
  */api/0) ;;
  *) api_base="$api_base/api/0" ;;
esac

response="$(
  curl -fsS \
    -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    "$api_base/projects/$SENTRY_ORG_SLUG/$SENTRY_PROJECT_SLUG/keys/"
)" || {
  printf '%s\n' "sentry-public-dsn.sh: failed to fetch Sentry project keys from $api_base" >&2
  exit 1
}

printf '%s' "$response" | python3 -c 'import json, sys
keys = json.load(sys.stdin)
if not keys:
    sys.exit(0)
dsn = keys[0].get("dsn", {})
print(dsn.get("public") or dsn.get("publicDsn") or "")'
