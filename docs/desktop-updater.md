# Kalio desktop updater

Kalio uses the Tauri updater plugin inside the main application. There is no
separate launcher: the running app checks for a release, shows a confirmation
notice, downloads the signed artifact, installs it, and relaunches itself.

## Where releases live

Signed installers and updater metadata belong in GitHub Releases, not in the
`main` branch:

```text
Git tag v1.0.1
  -> Windows NSIS installer + .sig
  -> Linux AppImage + .sig
  -> Linux DEB package
  -> latest.json
```

The application uses this public endpoint:

```text
https://github.com/Radomiej/kalio-forever/releases/latest/download/latest.json
```

The release workflow generates `latest.json` from the signed assets. The file
contains the platform-specific URL and the signature content required by
Tauri. The binaries and `latest.json` are release assets; they are intentionally
not committed to `main`.

The current workflow creates a draft release so it can be reviewed. Publish the
draft before testing the updater: GitHub's `latest` endpoint does not represent
an unpublished draft to normal clients.

## Trust model

Tauri updater signatures and Windows Authenticode are separate controls:

- `TAURI_UPDATER_PUBLIC_KEY` is embedded in the production app and verifies
  the updater artifact.
- `TAURI_SIGNING_PRIVATE_KEY` signs updater artifacts in CI. Never commit,
  print, or send this key in chat. Keep an offline backup; losing it prevents
  future updates for already-installed versions.
- `WINDOWS_CERTIFICATE_PFX_BASE64` and its password sign the Windows executable
  and installer for SmartScreen reputation. They do not replace the Tauri
  updater key.

Create the updater key once on a trusted machine:

```powershell
pnpm tauri signer generate -w "$HOME\.tauri\kalio-updater.key"
```

The command creates a private key and prints the public key. Store the public
key as the GitHub Actions secret `TAURI_UPDATER_PUBLIC_KEY` and the private key
content as `TAURI_SIGNING_PRIVATE_KEY`. Store the optional password as
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Tauri reads signing variables from the
CI environment; a repository `.env` file is not a release secret mechanism.

Do not rotate the updater key casually. Existing installations contain the old
public key and will reject artifacts signed by an unrelated key. A deliberate
key migration needs a separately shipped migration path.

## Release procedure

1. Update the version in `src-tauri/tauri.conf.json` and keep the source changes
   in the commit that will be tagged.
2. Push the commit and a matching tag, for example `v1.0.1` for version `1.0.1`.
3. Let `.github/workflows/desktop-release.yml` build Windows and Linux in
   separate runners.
4. Verify the draft release contains `latest.json`, the Windows installer and
   signature, the Linux AppImage and signature, the DEB package, licenses,
   notices, and checksums.
5. Publish the release. The updater then finds it through the `latest.json`
   endpoint.

Local builds remain unsigned and do not receive updater configuration by
default. To create a local signed bundle, generate a temporary config without
committing it:

```powershell
$env:TAURI_UPDATER_PUBLIC_KEY = '<paste-the-public-key-printed-by-signer-generate>'
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\kalio-updater.key" -Raw
pnpm desktop:updater-config -- .tmp/tauri-updater.json
pnpm tauri build --config .tmp/tauri-updater.json
```

The CI workflow is the authoritative release path because it also handles the
Windows code-signing certificate and the Linux runner environment.

## Verification checklist

- Install version `N` on a clean Windows and Linux x86_64 machine.
- Publish version `N+1` and verify `latest.json` has both
  `windows-x86_64` and `linux-x86_64` entries.
- Start version `N`, wait for the in-app notice, choose **Install and
  restart**, and verify the app comes back as `N+1` with its existing data.
- Reject/dismiss the notice and verify Kalio remains usable.
- Disable the network and start Kalio; update-check failure must not block the
  local backend or the main UI.
- Tamper with a downloaded artifact in a test release and verify signature
  validation prevents installation.
- Keep macOS out of the updater manifest until a signed macOS artifact and
  notarization path are added.

The implementation follows the [Tauri updater documentation](https://v2.tauri.app/plugin/updater/)
and the [Tauri GitHub pipeline guidance](https://v2.tauri.app/distribute/pipelines/github/).
