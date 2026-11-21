#!/bin/bash
set -euo pipefail

root="$HOME/Library/Application Support/Kalio"
repository="https://github.com/Radomiej/kalio-forever.git"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-root|--repository)
      [ "$#" -ge 2 ] && [ -n "$2" ] || { echo "Missing value for $1" >&2; exit 1; }
      case "$1" in
        --install-root) root="$2" ;;
        --repository) repository="$2" ;;
      esac
      shift 2 ;;
    --help) echo "Usage: bash install-macos.sh [--install-root PATH] [--repository GIT_URL]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[ "$(uname -s)" = Darwin ] || { echo "This installer requires macOS." >&2; exit 1; }
for tool in git node pnpm openssl; do
  command -v "$tool" >/dev/null || { echo "$tool is required. See docs/macos-installation.md." >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' ||
  { echo "Node.js 22 or newer is required." >&2; exit 1; }
[ "$(pnpm --version | cut -d. -f1)" = 9 ] ||
  { echo "pnpm 9 is required. Run npm install --global pnpm@9.15.0" >&2; exit 1; }
mkdir -p "$root"
root="$(cd "$root" && pwd)"
mkdir "$root/.operation-lock" 2>/dev/null || { echo "Another Kalio operation is running." >&2; exit 1; }
trap 'rmdir "$root/.operation-lock"' EXIT
if [ -e "$root/source" ]; then
  echo "Kalio source already exists. Use $root/bin/kalio update" >&2
  exit 1
fi
git clone -- "$repository" "$root/source"
# Leave a failed checkout available for diagnosis, without publishing a launcher.
cd "$root/source"
ONNXRUNTIME_NODE_INSTALL=skip pnpm install --frozen-lockfile
pnpm -r --filter @kalio/types --filter @kalio/sdk --filter kalio-api --filter kalio-web run build
mkdir -p "$root/data" "$root/bin"
if [ ! -e "$root/data/kalio.env" ]; then
  (umask 077; set -C; printf 'CREDENTIALS_MASTER_KEY=%s\n' "$(openssl rand -hex 32)" > "$root/data/kalio.env")
fi
{
  printf '#!/bin/bash\n'
  printf 'export PATH=%q:%q:"$PATH"\n' "$(dirname "$(command -v node)")" "$(dirname "$(command -v pnpm)")"
  printf 'exec /bin/bash %q "$@"\n' "$root/source/scripts/macos-cli.sh"
} > "$root/bin/kalio"
chmod +x "$root/bin/kalio"
printf 'Installed. Start Kalio with\n  "%s/bin/kalio" start\nAdd to your shell PATH\n  export PATH="%s/bin:$PATH"\n' "$root" "$root"
