#!/usr/bin/env bash
set -euo pipefail

runtime="node"
version="latest"
install_root=""
no_launch=0
public_key=""
repository="Radomiej/kalio-forever"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --runtime|--version|--install-root|--public-key)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "[kalio] $1 requires a value" >&2; exit 1
      fi ;;
  esac
  case "$1" in
    --runtime) runtime="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    --install-root) install_root="$2"; shift 2 ;;
    --no-launch) no_launch=1; shift ;;
    --public-key) public_key="$2"; shift 2 ;;
    *) echo "[kalio] unknown argument: $1" >&2; exit 1 ;;
  esac
done

command -v python3 >/dev/null 2>&1 || { echo "[kalio] python3 is required to verify release metadata" >&2; exit 1; }
case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64) ;;
  *) echo "[kalio] this release installer supports Linux x64" >&2; exit 1 ;;
esac

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
  tag="$(printf '%s' "$release_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
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
fetch_file "$base_url/kalio-runtime-manifest.json" "$tmp_root/manifest.json"
python3 - "$tmp_root/manifest.json" "$archive_path" "$tag" "$runtime" "$public_key" <<'PY'
import base64, hashlib, json, pathlib, subprocess, sys, tempfile
manifest_path, archive_path, tag, runtime, public_key = sys.argv[1:]
manifest = json.loads(pathlib.Path(manifest_path).read_text())
payload = base64.b64decode(manifest['payload'], validate=True)
metadata = json.loads(payload)
if metadata.get('schema') != 1 or metadata.get('tag') != tag or metadata.get('version') != tag[1:]:
    sys.exit('[kalio] release manifest does not match the requested release')
if manifest.get('signature') or public_key:
    if not public_key or manifest.get('signatureAlgorithm') != 'ed25519' or not manifest.get('signature'):
        sys.exit('[kalio] signed manifest requires --public-key from a trusted source and an Ed25519 signature')
    with tempfile.TemporaryDirectory() as temp:
        source, signature = pathlib.Path(temp)/'payload', pathlib.Path(temp)/'signature'
        source.write_bytes(payload)
        signature.write_bytes(base64.b64decode(manifest['signature'], validate=True))
        subprocess.run(['openssl','pkeyutl','-verify','-pubin','-inkey',public_key,'-rawin','-in',str(source),'-sigfile',str(signature)], check=True)
else:
    print('[kalio] manifest is unsigned; verifying release SHA-256 and size over HTTPS', file=sys.stderr)
archive = pathlib.Path(archive_path)
matches = [a for a in metadata['assets'] if a.get('name') == archive.name and a.get('platform') == 'linux' and a.get('architecture') == 'x64' and a.get('runtime') == runtime]
if len(matches) != 1:
    sys.exit('[kalio] release manifest has no unique matching Linux archive')
digest = hashlib.sha256()
with archive.open('rb') as stream:
    for chunk in iter(lambda: stream.read(1024*1024), b''):
        digest.update(chunk)
if digest.hexdigest() != matches[0]['sha256'] or archive.stat().st_size != matches[0]['size']:
    sys.exit('[kalio] release archive SHA-256 or size mismatch')
print('[kalio] release archive integrity verified')
PY

script_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ]; then
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fi
if [ -n "$script_dir" ] && [ -f "$script_dir/install.sh" ]; then
  cp "$script_dir/install.sh" "$installer_path"
else
  # TODO: legacy fallback: piped standalone bootstrap has no sibling installer.
  fetch_file "$raw_base_url/scripts/install.sh" "$installer_path"
fi
chmod +x "$installer_path"

installer_args=(--archive "$archive_path")
if [ -n "$install_root" ]; then
  installer_args+=(--install-root "$install_root")
fi
if [ "$no_launch" -eq 1 ]; then
  installer_args+=(--no-launch)
fi
bash "$installer_path" "${installer_args[@]}"
