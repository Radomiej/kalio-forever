#!/usr/bin/env bash
set -euo pipefail

archive=""
expected_sha256=""
install_root="${KALIO_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/kalio}"
no_launch=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --archive|--install-root|--sha256)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "[kalio] $1 requires a value" >&2; exit 1
      fi ;;
  esac
  case "$1" in
    --archive) archive="$2"; shift 2 ;;
    --sha256) expected_sha256="$2"; shift 2 ;;
    --install-root) install_root="$2"; shift 2 ;;
    --no-launch) no_launch=1; shift ;;
    *) echo "[kalio] unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "[kalio] usage: install.sh --archive ./kalio-runtime-<version>-linux-x64.tar.gz [--no-launch]" >&2
  exit 1
fi

case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64) ;;
  *) echo "[kalio] this archive installer requires Linux x64" >&2; exit 1 ;;
esac
if [ -n "$expected_sha256" ]; then
  if ! [[ "$expected_sha256" =~ ^[[:xdigit:]]{64}$ ]] || ! printf '%s  %s\n' "$expected_sha256" "$archive" | sha256sum --check --status; then
    echo "[kalio] SHA-256 checksum mismatch or invalid checksum" >&2; exit 1
  fi
fi

case "$install_root" in
  /|""|/usr|/usr/*|/etc|/etc/*) echo "[kalio] refusing unsafe install root: $install_root" >&2; exit 1 ;;
esac

if [ -e "$install_root/.runtime.lock" ]; then
  echo "[kalio] Kalio appears to be running; stop it before updating" >&2
  exit 1
fi

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/kalio-runtime.XXXXXX")"
trap 'rm -rf "$tmp_root"' EXIT
tar -xzf "$archive" -C "$tmp_root"
metadata_file="$(find "$tmp_root" -type f -name runtime.json -print -quit)"
if [ -z "$metadata_file" ]; then
  echo "[kalio] runtime.json is missing from the archive" >&2
  exit 1
fi
source_root="$(dirname "$metadata_file")"
version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$metadata_file" | head -n 1)"
platform="$(sed -n 's/.*"platform"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$metadata_file" | head -n 1)"
architecture="$(sed -n 's/.*"architecture"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$metadata_file" | head -n 1)"
runtime="$(sed -n 's/.*"runtime"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$metadata_file" | head -n 1)"
runtime="${runtime:-node}"
case "$runtime" in
  node|bun) ;;
  *) echo "[kalio] unsupported runtime: $runtime" >&2; exit 1 ;;
esac
if [ "$platform" != "linux" ] || [ "$architecture" != "x64" ] || [[ ! "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "[kalio] archive is not a valid Linux x64 Kalio runtime" >&2
  exit 1
fi
for required in bin/kalio "bin/kalio-$runtime"; do
  if [ ! -f "$source_root/$required" ]; then
    echo "[kalio] archive is missing $required" >&2; exit 1
  fi
done

mkdir -p "$install_root"
install_root="$(cd "$install_root" && pwd -P)"
case "$install_root" in
  /|/usr|/usr/*|/etc|/etc/*) echo "[kalio] refusing unsafe install root: $install_root" >&2; exit 1 ;;
esac

versions_root="$install_root/app/versions"
version_root="$versions_root/$version"
mkdir -p "$versions_root" "$install_root/bin" "$install_root/logs" "$install_root/cache" "$install_root/data"
staged_version="$versions_root/.install-$version-$$"
cp -a "$source_root" "$staged_version"
chmod +x "$staged_version/bin/kalio" "$staged_version/bin/kalio-$runtime"
rm -rf "$version_root"
mv "$staged_version" "$version_root"

env_file="$install_root/data/.env"
if [ ! -f "$env_file" ]; then
  umask 077
  if command -v openssl >/dev/null 2>&1; then
    master_key="$(openssl rand -base64 32)"
  else
    master_key="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  cat > "$env_file" <<EOF
NODE_ENV=production
PORT=4016
KALIO_HOST=127.0.0.1
KALIO_INSTALL_PROFILE=runtime
KALIO_SERVE_UI=true
KALIO_SQLITE_DRIVER=$runtime
DATABASE_PATH=$install_root/data/kalio.db
WORKSPACE_ROOT=$install_root/data/workspaces
MEMORY_DB_PATH=$install_root/data/memory
EMBEDDING_CACHE_DIR=$install_root/data/embeddings-cache
CREDENTIALS_MASTER_KEY=$master_key
CORS_ORIGIN=http://127.0.0.1:4016
LLM_PROVIDER=mock
LLM_API_KEY=mock
LLM_BASE_URL=mock
LLM_MODEL=mock
EOF
  chmod 600 "$env_file"
fi

mkdir -p "$install_root/data/workspaces" "$install_root/data/memory" "$install_root/data/embeddings-cache"
printf '{\n  "version": "%s",\n  "runtime": "%s",\n  "platform": "linux",\n  "architecture": "x64",\n  "apiProtocolVersion": "1",\n  "databaseSchemaVersion": "1"\n}\n' "$version" "$runtime" > "$install_root/current.json.tmp"
mv -f "$install_root/current.json.tmp" "$install_root/current.json"
runtime_binary="$version_root/bin/kalio-$runtime"
chmod +x "$version_root/bin/kalio" "$runtime_binary"

cat > "$install_root/bin/kalio.tmp" <<'EOF'
#!/bin/sh
set -eu
KALIO_HOME=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export KALIO_HOME
version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$KALIO_HOME/current.json" | head -n 1)
case "$version" in
  ""|.|..|*[!A-Za-z0-9._-]*) echo "[kalio] invalid current runtime version" >&2; exit 1 ;;
esac
exec "$KALIO_HOME/app/versions/$version/bin/kalio" "$@"
EOF
chmod 755 "$install_root/bin/kalio.tmp"
mv -f "$install_root/bin/kalio.tmp" "$install_root/bin/kalio"

echo "[kalio] runtime $version installed at $install_root"
echo "[kalio] data preserved at $install_root/data"
if [ "$no_launch" -eq 0 ]; then
  nohup "$install_root/bin/kalio" serve > "$install_root/logs/launcher.log" 2>&1 &
  echo "[kalio] launched in background; check $install_root/logs/launcher.log and /api/health for readiness"
fi
echo "[kalio] launcher: $install_root/bin/kalio (serve, doctor, update, uninstall)"
