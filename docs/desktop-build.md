# Kalio desktop build

The desktop package is a Windows Tauri application. Tauri serves the built
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
src-tauri/target/release/bundle/nsis/Kalio_1.0.0_x64-setup.exe
```

`desktop:build` performs the following release steps:

1. Builds the API and web workspaces.
2. Deploys the API's production dependencies into a private Tauri resource
   directory.
3. Copies the system `node.exe` into the bundle.
4. Rewrites the packaged runtime configuration to the desktop loopback port.
5. Builds the per-user NSIS installer.

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

The installer is not code-signed by this repository yet. A public Windows
release still needs a signing certificate, a selected open-source license, and
a tested upgrade/uninstall path on a clean machine.
