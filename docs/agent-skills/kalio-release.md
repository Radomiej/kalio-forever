# Kalio release skill

Use this skill for version bumps, desktop/runtime release preparation, GitHub Actions release runs, and release verification.

## Version source of truth

Kalio keeps the release version synchronized in every application/workspace package.json manifest plus:

- src-tauri/Cargo.toml
- src-tauri/Cargo.lock
- src-tauri/tauri.conf.json

The exact manifest list is owned by scripts/bump-version.mjs. Do not edit only one version file. Run:

~~~text
node scripts/bump-version.mjs 1.0.1
node scripts/bump-version.mjs --check
~~~

The script refuses to continue when the four files already contain different versions. It accepts stable MAJOR.MINOR.PATCH versions only.

## Release procedure

1. Start from a clean branch and inspect git status.
2. Run the version bump script and review the four-file diff.
3. Run node scripts/bump-version.mjs --check.
4. Run the focused release/runtime tests, then the affected API build/typecheck and the desktop preparation/build.
5. Push the branch and wait for the pull-request workflow.
6. Create the matching annotated tag, for example v1.0.1, only after the branch commit is verified:

~~~text
git tag -a v1.0.1 -m "Kalio v1.0.1"
git push origin v1.0.1
~~~

7. The desktop-release.yml workflow builds Windows and Linux runtime archives and Tauri packages. The release job creates or updates a draft GitHub Release for the tag.
8. Review checksums, runtime metadata, installer artifacts, and updater manifests. Publish the draft only after the required target-runtime checks pass.

## Runtime-specific gates

- Linux Bun archives use the baseline Bun binary for CPUs without AVX2. Do not replace it with the standard Haswell/AVX2 binary.
- A runtime smoke test must verify /api/runtime/info, the embedded UI root route, SQLite driver, and lock refusal during an update.
- Reinstalling the same archive is not proof of a version-to-version update. A real updater gate needs two distinct version archives and must verify that data/ survives.
- Tauri updater signatures and Windows Authenticode are optional in the current release lane. Missing signatures are warnings; do not call an unsigned artifact signed.
- The release workflow must run node scripts/bump-version.mjs --check before creating release metadata.

## Merge gate

Do not merge a release branch while:

- the version check fails;
- the target build job is red;
- the artifact was not inspected for the target OS;
- a required updater or runtime manifest is missing;
- a Rust/Tauri compilation error remains.

Record any intentionally unverified boundary explicitly in the PR description and release notes.
