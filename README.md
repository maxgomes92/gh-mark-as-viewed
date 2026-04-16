# GitHub Mark as Viewed

<img src="icon.svg" width="64" align="right" alt="Extension icon">

A Chrome extension that bulk-marks (or unmarks) GitHub PR files as **Viewed** using glob patterns — useful when a PR has many auto-generated or irrelevant files you want to dismiss at once.

## Features

- Match files by glob patterns (`*`, `**`, `?` supported)
- Leave patterns empty to target all files in the diff
- Works with GitHub's current and legacy PR diff UI
- Patterns are saved between sessions

## Usage

1. Open a GitHub Pull Request and go to the **Files changed** tab
2. Click the extension icon in your toolbar
3. Enter one glob pattern per line, e.g.:

   ```
   *.ndjson
   **/*.generated.ts
   src/locales/**
   ```

4. Click **Mark as viewed** or **Unmark**

The status line will report how many matched files were toggled.

### Pattern rules

| Pattern | Matches |
|---|---|
| `*.ndjson` | Any `.ndjson` file, at any depth |
| `**/*.test.ts` | Any `.test.ts` file, at any depth |
| `src/**` | Everything under `src/` |
| `src/*/index.ts` | `index.ts` one level inside `src/` |
| _(empty)_ | All files in the diff |

Patterns without a `/` are matched against the **filename only**. Patterns containing a `/` are matched against the **full path**.

## Installation

Load the extension:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this directory
