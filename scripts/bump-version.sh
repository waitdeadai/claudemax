#!/usr/bin/env bash
set -euo pipefail

# Atomically bump the .version field in package.json and plugin.json.
# Usage: scripts/bump-version.sh <semver>

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <semver>" >&2
  exit 2
fi

version="$1"
semver_re='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
if ! [[ "$version" =~ $semver_re ]]; then
  echo "error: '$version' is not a valid SemVer (expected MAJOR.MINOR.PATCH[-prerelease][+build])" >&2
  exit 1
fi

bump_one() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "error: $file not found" >&2
    exit 1
  fi
  local tmp
  tmp="$(mktemp "${file}.XXXXXX")"
  jq --arg v "$version" '.version = $v' "$file" > "$tmp"
  mv "$tmp" "$file"
  echo "updated $file -> $version"
}

bump_one "package.json"
bump_one "plugin.json"
