# Kalio desktop build

The desktop package is a Windows/Linux Tauri application. Tauri serves the built
React frontend from its local protocol and starts the production NestJS API as
a bundled Node.js child process.

## Build

Run from the repository root with the system Node.js installation:

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
pnpm install
pnpm desktop:build
```

The installer is created at:

```text
src-tauri/target/release/bundle/nsis/Kalio_1.0.2_x64-setup.exe
```

`desktop:build` performs the following release steps:

1. Builds the API and web workspaces.
2. Deploys the API's production dependencies into a private Tauri resource
   directory.
3. Copies the system Node.js runtime into the bundle (`kalio-node.exe` on
   Windows, `kalio-node` on Linux).
4. Rewrites the packaged runtime configuration to the desktop loopback port.
5. Builds the per-user NSIS installer.

The NSIS bundle uses `zlib` compression instead of the slower default LZMA
compression so local and CI release builds finish predictably. The trade-off
is a larger installer file.

## Runtime data

The desktop runtime uses Tauri's local application-data directory:

```text
%LOCALAPPDATA%\com.radomiej.kalio\
```

It creates `kalio.db`, `workspaces`, `memory`, `embeddings-cache`, and
`logs\backend.log` there. A fresh process uses the mock provider until the user
configures a real provider; provider settings can be entered through Kalio
Settings. The generated `.env` file persists the credentials master key.

The desktop API is bound to `127.0.0.1:4516` and accepts requests from the
Tauri production origin `http://tauri.localhost`. If that port is occupied, the
application stops with a startup error and leaves the existing listener alone.

## Release checks

Before publishing the installer, run:

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm desktop:build
```

Local builds pass Tauri's `--no-sign` flag. A public Windows/Linux release is
governed by the source-available license in the repository and the commercial
license policy. Tagged releases are built by
`.github/workflows/desktop-release.yml`. The current lane intentionally does
not perform Windows Authenticode signing. Tauri updater signing is optional:
with the three updater secrets the workflow signs updater artifacts and
creates `latest.json`; without them it emits a warning and produces an
unsigned/manual-update release. See [desktop-updater.md](desktop-updater.md)
for the key and release procedure.

## GitHub Actions release

The desktop workflow runs Windows and Linux jobs for pull requests, manual runs,
and tags matching `v*`. Windows produces an NSIS installer; Linux produces an
AppImage and DEB package. When updater signing is configured, tagged builds
additionally produce Tauri `.sig` files and the release job generates
`latest.json` from those signed assets. A matching version tag creates or
updates a draft GitHub Release.

The tag must match `src-tauri/tauri.conf.json`, for example `v1.0.2` for
version `1.0.2`. The following three Actions secrets are the optional Tauri
updater-signing set:

- `TAURI_SIGNING_PRIVATE_KEY` — Tauri updater private key content;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password used for that key; the
  current workflow requires a non-empty value when signing is enabled; and
- `TAURI_UPDATER_PUBLIC_KEY` — Tauri updater public key content.

All three updater secrets must be set together. Pull-request, `main`, and
manual builds may run without them. A tagged build without them continues with
a warning, does not generate `latest.json`, and requires manual installation.
The workflow attaches the following release documents next to the installer:
`LICENSE`,
`COMMERCIAL-LICENSE.md`, `COMMERCIAL-LICENSE-AGREEMENT-TEMPLATE.md`,
`THIRD_PARTY_NOTICES.md`, and platform-specific `SHA256SUMS-*.txt` files.

Standalone runtime manifest signing is a separate optional layer:

- `KALIO_RUNTIME_SIGNING_PRIVATE_KEY` — optional Actions secret used to sign
  `kalio-runtime-manifest.json`;
- `KALIO_RUNTIME_UPDATE_PUBLIC_KEY` — optional repository variable containing
  the matching public key, embedded in packaged runtime archives.

If those two values are absent, the runtime release still contains SHA-256
metadata, but the manifest is unsigned and the updater must use its deliberate
unsigned/manual path.

See Tauri's [Windows code-signing guide](https://v2.tauri.app/distribute/sign/windows/)
for certificate requirements and SmartScreen behavior.

To generate the notices locally:

```powershell
pnpm release:third-party-notices -- --output release/THIRD_PARTY_NOTICES.md
```
