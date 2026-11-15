#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Linux runtime archive required}"
version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
test "$(basename "$archive")" = "kalio-runtime-${version}-linux-x64.tar.gz"
sha256="$(sha256sum "$archive" | cut -d ' ' -f 1)"
suffix="$(node -p "require('node:crypto').randomUUID()")"
image="kalio-runtime-smoke:$suffix"
project="kalio-runtime-smoke-$suffix"
export KALIO_IMAGE="$image" KALIO_HTTP_PORT=0
compose=(docker compose -p "$project" -f compose.kalio.yml)

cleanup() {
  local status=$?
  if (( status != 0 )); then "${compose[@]}" logs --tail 80 kalio || true; fi
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --platform linux/amd64 \
  --build-arg "RUNTIME_VERSION=$version" --build-arg "RUNTIME_SHA256=$sha256" \
  --tag "$image" .

start_container() {
  "${compose[@]}" up -d --pull never >/dev/null
  local binding
  binding="$("${compose[@]}" port kalio 4016)"
  url="http://$binding"
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if curl --max-time 2 -fsS "$url/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Kalio health check did not become ready at $url" >&2
  return 1
}

start_container
test "$("${compose[@]}" exec -T kalio id -u)" = 10001
"${compose[@]}" exec -T kalio test -d /data/ra-apps
curl --max-time 5 -fsS "$url/" | grep -F 'id="root"' >/dev/null
session="$(curl --max-time 5 -fsS "$url/api/sessions" -H 'Content-Type: application/json' \
  --data '{"title":"OCI volume smoke"}' | node -pe "JSON.parse(require('node:fs').readFileSync(0,'utf8')).id")"
[[ "$session" =~ ^[A-Za-z0-9_-]+$ ]]
"${compose[@]}" down >/dev/null

start_container
title="$(curl --max-time 5 -fsS "$url/api/sessions/$session" | \
  node -pe "JSON.parse(require('node:fs').readFileSync(0,'utf8')).title")"
test "$title" = 'OCI volume smoke'
printf '%s\n' 'Linux container API, embedded UI, non-root user and session persistence passed.'
