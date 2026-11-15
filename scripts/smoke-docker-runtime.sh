#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Linux runtime archive required}"
version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
test "$(basename "$archive")" = "kalio-runtime-${version}-linux-x64.tar.gz"
sha256="$(sha256sum "$archive" | cut -d ' ' -f 1)"
suffix="$(node -p "require('node:crypto').randomUUID()")"
image="kalio-runtime-smoke:$suffix"
container="kalio-runtime-smoke-$suffix"
volume="${container}-data"

cleanup() {
  local status=$?
  if (( status != 0 )); then docker logs --tail 80 "$container" || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --platform linux/amd64 \
  --build-arg "RUNTIME_VERSION=$version" --build-arg "RUNTIME_SHA256=$sha256" \
  --tag "$image" .
docker volume create "$volume" >/dev/null

start_container() {
  docker run -d --name "$container" --mount "type=volume,source=$volume,target=/data" \
    -p 127.0.0.1::4016 "$image" >/dev/null
  local binding
  binding="$(docker port "$container" 4016/tcp)"
  url="http://$binding"
  curl --max-time 3 --retry 20 --retry-connrefused --retry-delay 1 -fsS "$url/api/health" >/dev/null
}

start_container
test "$(docker exec "$container" id -u)" = 10001
curl --max-time 5 -fsS "$url/" | grep -F 'id="root"' >/dev/null
session="$(curl --max-time 5 -fsS "$url/api/sessions" -H 'Content-Type: application/json' \
  --data '{"title":"OCI volume smoke"}' | node -pe "JSON.parse(require('node:fs').readFileSync(0,'utf8')).id")"
[[ "$session" =~ ^[A-Za-z0-9_-]+$ ]]
docker stop "$container" >/dev/null
docker rm "$container" >/dev/null

start_container
title="$(curl --max-time 5 -fsS "$url/api/sessions/$session" | \
  node -pe "JSON.parse(require('node:fs').readFileSync(0,'utf8')).title")"
test "$title" = 'OCI volume smoke'
printf '%s\n' 'Linux container API, embedded UI, non-root user and session persistence passed.'
