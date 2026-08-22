#!/usr/bin/env bash
set -euo pipefail

runtime="node"
version="latest"
install_root=""
no_launch=0
repository="Radomiej/kalio-forever"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --runtime) runtime="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    --install-root) install_root="$2"; shift 2 ;;
    --no-launch) no_launch=1; shift ;;
    *) echo "[kalio] unknown argument: $1" >&2; exit 1 ;;
  esac
done

case "$runtime" in
  node|bun) ;;
  *) echo "[kalio] runtime must be node or bun" >&2; exit 1 ;;
esac

fetch_text() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -A "Kalio-release-installer" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- --user-agent="Kalio-release-installer" "$1"
  else
    echo "[kalio] curl or wget is required" >&2
    exit 1
  fi
}

fetch_file() {
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 -A "Kalio-release-installer" "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --user-agent="Kalio-release-installer" -O "$2" "$1"
  else
    echo "[kalio] curl or wget is required" >&2
    exit 1
  fi
}

if [ "$version" = "latest" ]; then
  release_json="$(fetch_text "https://api.github.com/repos/$repository/releases/latest")"
  tag="$(printf '%s' "$release_json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
else
  case "$version" in
    v*) tag="$version" ;;
    *) tag="v$version" ;;
  esac
fi

if ! printf '%s' "$tag" | grep -Eq '^v[A-Za-z0-9][A-Za-z0-9._-]*$'; then
  echo "[kalio] invalid GitHub release tag: $tag" >&2
  exit 1
fi

release_version="${tag#v}"
runtime_suffix=""
if [ "$runtime" = "bun" ]; then
  runtime_suffix="-bun"
fi
asset_name="kalio-runtime-${release_version}${runtime_suffix}-linux-x64.tar.gz"
base_url="https://github.com/$repository/releases/download/$tag"
raw_base_url="https://raw.githubusercontent.com/$repository/$tag"
tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/kalio-release.XXXXXX")"
trap 'rm -rf "$tmp_root"' EXIT
archive_path="$tmp_root/$asset_name"
installer_path="$tmp_root/install.sh"

echo "[kalio] downloading $asset_name from $tag"
fetch_file "$base_url/$asset_name" "$archive_path"
fetch_file "$raw_base_url/scripts/install.sh" "$installer_path"
chmod +x "$installer_path"

installer_args=(--archive "$archive_path")
if [ -n "$install_root" ]; then
  installer_args+=(--install-root "$install_root")
fi
if [ "$no_launch" -eq 1 ]; then
  installer_args+=(--no-launch)
fi
bash "$installer_path" "${installer_args[@]}"
