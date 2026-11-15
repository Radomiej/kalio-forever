# Kalio API and web image

The image wraps the Linux amd64 Node runtime archive. Kalio serves the API,
Socket.IO, and embedded web UI on port 4016. This spec describes the inputs and
smoke checks for an isolated build. Container build and runtime proof are pending.

## Build on an isolated Linux amd64 runner

Use Node.js 22, Corepack, and Docker BuildKit. From the checkout root, produce
the archive with the same commands used by the Linux runtime release workflow.
Use a clean `release/` directory containing only the intended archive when
passing the build context to BuildKit.

```bash
corepack enable
export ONNXRUNTIME_NODE_INSTALL=skip
pnpm install --frozen-lockfile
pnpm build
node scripts/build-runtime-package.mjs --platform linux --output release --runtime node

version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
archive="release/kalio-runtime-${version}-linux-x64.tar.gz"
sha256="$(sha256sum "$archive" | cut -d ' ' -f 1)"
docker buildx build --platform linux/amd64 --load \
  --build-arg RUNTIME_VERSION="$version" --build-arg RUNTIME_SHA256="$sha256" \
  --tag "kalio:${version}" .
```

If CI passes the archive between jobs, use the checksum from the trusted
artifact producer. Use an archive produced from the intended revision.

## Run and verify on that runner

```bash
docker run -d --name kalio-smoke \
  --mount type=volume,source=kalio-smoke-data,target=/data \
  -p 127.0.0.1:4016:4016 "kalio:${version}"

curl --retry 15 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:4016/api/health
curl -fsS http://127.0.0.1:4016/api/runtime/info
curl -fsS http://127.0.0.1:4016/ | grep -F 'id="root"'
docker exec kalio-smoke id
```

Check that the runtime reports the Node SQLite driver and embedded UI and that
the process runs as UID/GID 10001. Confirm the database and generated
credential key appear in `/data`. Stop and remove the test container, recreate
it with the same named volume, and confirm a record created before the stop
is still readable. Use one container per volume. For a bind mount, provide a
directory writable by UID/GID 10001.

Keep the volume when replacing the container with a new image. It holds SQLite
state, workspaces, memory, and the generated credential key. Supply provider
credentials at runtime, for example with `docker run --env-file` using a file
outside the build context.

## Install from a registry image

Once a release image is published, place the accompanying compose.kalio.yml
in a local directory. Set KALIO_IMAGE in the shell to the image reference
from that release, preferably including its digest. Run:

```bash
docker compose -f compose.kalio.yml pull
docker compose -f compose.kalio.yml up -d
```

Open http://127.0.0.1:4016. Set KALIO_HTTP_PORT before starting if port
4016 is occupied. Configure a provider in the Kalio UI. Keep the same Compose
project directory and named volume when updating the image reference.
