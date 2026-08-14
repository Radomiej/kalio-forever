# RA-App Plugin ZIP Upload

This document describes the supported way to install a custom RA-App into a local or administrator-managed Kalio instance.

## What It Installs

The RA-App manager accepts a ZIP upload from **Tools -> RAApps -> Catalog -> Upload ZIP**. The backend validates the archive, stores it under the configured `RA_APPS_PATH/user/` directory, loads it into the catalog, and makes it available to `list_raapps` and `run_raapp`.

The upload is a standalone RA-App package. It is not an arbitrary Node.js plugin and it cannot register backend code. Backend/native operations remain controlled by the existing RA-App systems policy and HITL confirmation flow.

## ZIP Layout

Files must be at the root of the archive. A top-level folder is not supported.

Required:

- `meta.yml`
- Exactly one renderable entry: `main.html`, `index.html`, or `ui.gui`

Optional:

- `systems.yml`
- `tests.yml`
- `components.yml`

The current allowlist intentionally excludes arbitrary assets, JavaScript files, and nested directories. HTML apps render in the isolated RA-App frame and communicate through the existing renderer bridge. GUI apps use the `ui.gui` DSL.

## Minimal HTML Example

`meta.yml`:

```yaml
id: custom-calculator
name: Custom Calculator
version: 1.0.0
description: A user-installed calculator
author: local
tags:
  - math
  - custom
input_schema:
  type: object
  required:
    - a
    - b
    - operation
  properties:
    a:
      type: number
    b:
      type: number
    operation:
      type: string
      enum: [add, subtract, multiply, divide]
```

`main.html`:

```html
<main>
  <h1>Custom Calculator</h1>
  <p>This page is rendered by the RA-App runtime.</p>
</main>
```

Create the archive with files at its root:

```powershell
New-Item -ItemType Directory -Force .\custom-calculator | Out-Null
# Put meta.yml and main.html directly in .\custom-calculator
Compress-Archive -Path .\custom-calculator\* -DestinationPath .\custom-calculator.zip -Force
```

Do not archive the parent directory itself. The ZIP must contain `meta.yml` and `main.html`, not `custom-calculator/meta.yml`.

## Upload And Run

1. Open **Tools -> RAApps** and select **Catalog**.
2. Click **Upload ZIP** or drop the archive into the upload area.
3. After the upload succeeds, refresh is automatic and the app appears under user apps.
4. Optionally fill **Run inputs (optional JSON)** before pressing **Run**. Example:

```json
{"a": 5, "b": 2, "operation": "add"}
```

The inputs are passed to the first `run_raapp` call for that launch. Invalid JSON or a JSON array/scalar is rejected in the manager before a session is created.

The same app can be invoked by the LLM through the normal RA-App tools:

```text
list_raapps()
run_raapp({"id":"custom-calculator","inputs":{"a":5,"b":2,"operation":"add"}})
```

`systems.yml` may request supported native systems, but operations that require confirmation still pause for HITL approval. Uploading a package does not bypass tool policy.

## Validation Limits

The upload validator enforces:

- Maximum compressed ZIP size: 5 MiB
- Maximum total uncompressed size: 10 MiB
- Maximum individual file size: 5 MiB
- Maximum `meta.yml` size: 512 KiB
- Maximum file count: 7
- Root-only files from the allowlist above
- No traversal, absolute paths, backslashes, duplicate entries, encrypted entries, or symlinks
- Valid `meta.yml` object with a lowercase `id` of 1-64 characters and a non-empty `name`

An existing app ID is rejected with a conflict. Uploading a new archive does not overwrite a released app. Use the existing draft/publish/versioning flow when updating a versioned app.

## Troubleshooting

- **No app in the catalog:** confirm that the archive contains root `meta.yml` plus `main.html`, `index.html`, or `ui.gui`.
- **Unsupported entry:** remove nested folders, README files, arbitrary assets, and backend source files from the archive.
- **ID conflict:** choose a new `meta.yml` `id`, or update the existing app through its draft/version workflow.
- **Run fails with missing inputs:** enter a JSON object in the Catalog input field or provide `inputs` in `run_raapp`.
- **App appears after upload but not after restart:** check the configured `RA_APPS_PATH` and confirm the persisted file is under `RA_APPS_PATH/user/<id>.zip`.

After a successful upload, reload the page or restart the local stack once to verify that the app is restored from disk rather than only held in memory.
