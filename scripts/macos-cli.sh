#!/bin/bash
set -euo pipefail
source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="$(dirname "$source_root")"
cd "$source_root"
action="${1:-help}"
stack() {
  node scripts/stack-manager.mjs "$1" --profile prod --backend-port 4016 --frontend-port 6188 \
    --data-root "$root/data" --env-file "$root/data/kalio.env" --use-env-llm "${@:2}"
}
case "$action" in
  start|stop|update)
    mkdir "$root/.operation-lock" 2>/dev/null || { echo "Another Kalio operation is running." >&2; exit 1; }
    trap 'rmdir "$root/.operation-lock"' EXIT ;;
esac
case "$action" in
  start) stack start --skip-build ;;
  stop) stack stop ;;
  status) stack status ;;
  open) open http://127.0.0.1:6188/ ;;
  update)
    [ -z "$(git status --porcelain)" ] || { echo "Local source changes found. Commit or restore them before updating." >&2; exit 1; }
    git fetch origin
    # Refuse divergent histories before interrupting the running application.
    git merge-base --is-ancestor HEAD '@{upstream}' ||
      { echo "Source diverges from upstream. Resolve it before updating." >&2; exit 1; }
    stack stop
    git merge --ff-only '@{upstream}'
    ONNXRUNTIME_NODE_INSTALL=skip pnpm install --frozen-lockfile
    pnpm -r --filter @kalio/types --filter @kalio/sdk --filter kalio-api --filter kalio-web run build
    stack start --skip-build ;;
  help|--help|-h) echo "Usage: kalio <start|stop|status|open|update>" ;;
  *) echo "Unknown command: $action" >&2; exit 1 ;;
esac
