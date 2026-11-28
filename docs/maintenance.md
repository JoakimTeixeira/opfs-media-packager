# Maintenance and troubleshooting

This guide helps a contributor locate the code and verify changes to OPFS Media Packager.

## Find the owning code

The browser entry points are in [`src/`](../src/). The [architecture map](project-map.md) identifies each entry point and its responsibility. Reusable rules and their unit tests are grouped by feature in [`lib/`](../lib/). Cross-module checks are in [`tests/`](../tests/), grouped into integration tests, browser flows, contracts, and architecture checks.

| Change                          | Where to start                                                           | Evidence to find or add                                             |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Track page detection            | Page adapters in `lib/` and the page-observation entry points in `src/`. | Adapter rules and track-scan integration tests.                     |
| Item request pacing             | Track scanning entry points in `src/`.                                   | Integration tests for request spacing, retries, and host limits.    |
| Download queue and cancellation | Downloader entry point in `src/` and queue rules in `lib/`.              | Browser tests for cancellation, resume, and access failures.        |
| File names and destination      | Filename and download-folder rules in `lib/`.                            | Tests for valid names, matching subtitles, and destination folders. |
| Stored video parts and resume   | Download coordination in `src/` and checkpoint rules in `lib/`.          | Checkpoint validation and browser download recovery tests.          |
| Subtitle language and filtering | Subtitle rules in `lib/`.                                                | Tests for language recognition and usable subtitle tracks.          |

Search for the named responsibility or behaviour within these folders. Run the relevant tests before and after changing it, then run the release checks below.

## Diagnose common failures

| Symptom                            | First checks                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No video appears in the popup      | Reload the source page after installing the extension, play the video and check whether its media request is supported. Verify the active tab and popup detection tests.                 |
| HTTP 401 or 403                    | Confirm the page still plays the video in the signed-in session. Refresh the page and inspect how the media request is authorized. Do not copy or publish signed URLs or credentials.    |
| HTTP 429 or 503                    | The host may be overloaded or asking for fewer requests. Check the page scan retry policy and the separate segment download retry policy. Wait before retrying.                          |
| Save dialog appears for every file | Check Chrome's setting at `chrome://settings/downloads`. Automatic saving depends on the browser's configured download behaviour.                                                        |
| Large video fails or cannot resume | Check available disk space and browser storage access. Review checkpoint validation, the browser download test and the memory-backed fallback.                                           |
| Video plays incorrectly            | Check duration, audio and video synchronization in a media player. Capture a small reproducible media sample when authorized and compare input with output using media inspection tools. |

## Review and release

Run `npm ci`, `npm run build`, then the checks in [testing-and-quality.md](testing-and-quality.md). Run `npm run test:mutation` separately. Record the exact command and result in the change description.

The current harness scan is L4 at 105/105. The read-only change verifier is available as both a Copilot custom agent and an OpenCode subagent.

For a reported regression, add a test that reproduces the user-visible behaviour before changing the implementation. Use fictional URLs and remove access tokens from shared test data and logs.

When reviewing a change, confirm the affected documents identify the entry point, behaviour, error handling and tests. Check whether any linked architecture decision still describes the implementation. Record unchecked assumptions and any manual media playback that was not performed.

## Agent hooks

Run `npm run setup:hooks` once per clone to enable `.githooks/pre-commit`. It runs lint, strict type checking, and unit tests before each commit. Copilot workspace hooks in `.github/hooks/` block selected destructive shell commands and format supported edited files with Prettier. Review hook changes as executable code and run `npm run harness:score` after changing harness files.

## Verify a deleted download

Chrome's downloads history updates file existence asynchronously and may perform a filesystem check no more than once every 10 seconds. A search can therefore return a stale result immediately after deletion. The browser test for deleted subtitles allows up to 25 seconds for the history to update before verifying that the subtitle is downloaded again. This timing is a test condition and does not guarantee instant recognition of an externally deleted file in normal use. See [Chrome downloads documentation](https://developer.chrome.com/docs/extensions/reference/api/downloads).
