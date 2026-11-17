#!/bin/sh
# Update only index.html so a reused web image can point at the deployed release.
set -eu

PLACEHOLDER="__OPENATHLETE_SOURCE_CODE_URL__"
DEFAULT_SOURCE_URL="https://github.com/GustaTheCreator/openathlete/tree/tourmalet"
INDEX=/usr/share/nginx/html/index.html

if ! grep -qF "$PLACEHOLDER" "$INDEX"; then
  exit 0
fi

SOURCE_URL="${SOURCE_CODE_URL:-$DEFAULT_SOURCE_URL}"
if [ "$(printf '%s' "$SOURCE_URL" | tr -d '\r\n')" != "$SOURCE_URL" ]; then
  echo 'SOURCE_CODE_URL must be one line' >&2
  exit 1
fi
if [ "$SOURCE_URL" = "$PLACEHOLDER" ]; then
  SOURCE_URL="$DEFAULT_SOURCE_URL"
fi

# Keep the value safe in both an HTML attribute and a sed replacement.
if ! printf '%s' "$SOURCE_URL" | grep -Eq '^(https://[A-Za-z0-9._~:/?#@!$()*+,;=%-]+|/[A-Za-z0-9._~/-]*)$' \
  || [ "${SOURCE_URL#//}" != "$SOURCE_URL" ]; then
  echo 'SOURCE_CODE_URL must be an HTTPS URL or a root-relative path' >&2
  exit 1
fi

sed -i "s|$PLACEHOLDER|$SOURCE_URL|g" "$INDEX"
echo 'Web source link configured'
