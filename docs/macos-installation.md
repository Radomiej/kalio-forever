# Install Kalio on macOS

Kalio offers experimental source installation for Apple Silicon as a local web application.
Installation and lifecycle checks passed on Apple Silicon with macOS 26.3,
Node.js 24.22.3 and pnpm 9.15.0. The supported hardware scope is Apple Silicon.
The tested update rebuilt the same application revision.

## Prerequisites

Install Apple's Command Line Tools with `xcode-select --install`.
With [Homebrew](https://brew.sh/) installed, run:

```sh
brew install node@24
export PATH="$(brew --prefix node@24)/bin:$PATH"
npm install --global pnpm@9.15.0
```

The installer requires Node.js 22 or newer, pnpm 9, Git and OpenSSL.
Native SQLite dependencies may compile locally using the Command Line Tools.

## Install

From a checkout containing these scripts:

```sh
bash scripts/install-macos.sh --repository "$PWD"
```

A local repository installation fetches updates from that checkout. Pull new
GitHub changes into the checkout before running `kalio update`.

Install directly from GitHub with the standalone bootstrap:

```sh
curl -fsSL https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-macos.sh -o /tmp/kalio-install-macos.sh &&
bash /tmp/kalio-install-macos.sh
```

Use `--install-root "/custom/path"` for another location. The optional
`--repository GIT_URL` selects a fork or local Git repository for testing.

Add the installed CLI to the current shell and to your `~/.zshrc`:

```sh
export PATH="$HOME/Library/Application Support/Kalio/bin:$PATH"
```

## Run and update

```sh
kalio start
kalio open
kalio status
kalio stop
kalio update
```

The browser UI uses http://127.0.0.1:6188 and the API uses port 4016.
Start and update run the production profile through the existing stack manager.
Processes continue after the Terminal closes. Run `kalio start` after reboot.

Updates fetch the tracked Git branch, refuse local modifications or divergent
history, stop the application, install locked dependencies, rebuild and restart.
A failed install or build exits with an error and leaves the application stopped.
Correct the reported failure and rerun `kalio update`. Updates follow `main`,
which can include changes newer than published releases.

## Data and configuration

The default root is `~/Library/Application Support/Kalio`.

- `source` contains the Git checkout, dependencies and process logs under `.tmp`.
- `data` contains the SQLite database, workspaces, memory and embeddings cache.
- `data/kalio.env` contains the generated credential encryption key and optional
  `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, and `LLM_API_KEY` values.

Preserve the entire data directory and its encryption key when moving or backing
up the installation. Direct LLM access stays unconfigured until a provider
is configured in the UI or environment file. Updating preserves this directory.

Concurrent install/start/stop/update operations are refused with a lock directory.
If an interrupted process leaves `.operation-lock`, verify no operation is running
before removing that empty directory with `rmdir`.

To remove the installation, stop Kalio, then remove its installation root and
the PATH entry. Back up data first if you intend to reuse it.

## Current recovery limitations

A failed initial dependency install or build leaves the source checkout for
diagnosis and may leave the launcher uncreated. After correcting the reported
failure, move the failed source directory aside before rerunning the installer.
Preserve any existing data directory.

The shared stack manager identifies saved processes using listeners at the
saved ports. Following an unclean exit or reboot, check that those ports belong
to Kalio before invoking stop or update. Process ownership validation needs
hardening before stable support is declared.
