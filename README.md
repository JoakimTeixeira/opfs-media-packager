# OPFS Media Packager

![Harness Score](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FJoakimTeixeira%2Fopfs-media-packager%2Fci-badges%2Fharness.json&style=flat-square&labelColor=14232f&logo=lighthouse&logoColor=white) [![CI/CD](https://img.shields.io/github/actions/workflow/status/JoakimTeixeira/opfs-media-packager/ci.yml?branch=main&style=flat-square&label=CI%2FCD&labelColor=14232f)](https://github.com/JoakimTeixeira/opfs-media-packager/actions/workflows/ci.yml) ![Tests](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FJoakimTeixeira%2Fopfs-media-packager%2Fci-badges%2Ftests.json&style=flat-square&labelColor=14232f&logo=node.js&logoColor=white) ![Line coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FJoakimTeixeira%2Fopfs-media-packager%2Fci-badges%2Fline-coverage.json&style=flat-square&labelColor=14232f&logo=v8&logoColor=white) ![Branch coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FJoakimTeixeira%2Fopfs-media-packager%2Fci-badges%2Fbranch-coverage.json&style=flat-square&labelColor=14232f&logo=v8&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&labelColor=14232f&logo=typescript&logoColor=white) ![Chrome MV3](https://img.shields.io/badge/Chrome-MV3%20120%2B-4285f4?style=flat-square&labelColor=14232f&logo=googlechrome&logoColor=white) ![Code Style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4?style=flat-square&labelColor=14232f&logo=prettier&logoColor=white) ![Lint: ESLint](https://img.shields.io/badge/lint-eslint-4b32c3?style=flat-square&labelColor=14232f&logo=eslint&logoColor=white) ![License: MIT](https://img.shields.io/badge/license-MIT-dfb317?style=flat-square&labelColor=14232f&logo=opensourceinitiative&logoColor=white)

OPFS Media Packager (`v2.49`) is a local-first Chrome Manifest V3 extension that packages authorized streaming videos, subtitles, and companion page documents into portable offline files directly in the browser.

It detects HLS video streams (where a `.m3u8` manifest lists sequential video pieces called segments), direct video files, WebVTT subtitles, and companion documents. Large streams are buffered on Chrome's Origin Private File System (OPFS) with resumable checkpoints, remuxed losslessly into MP4 or MKV via bundled FFmpeg WebAssembly, and saved through Chrome Downloads.

## Harness score

Latest scan from [harness-score](https://github.com/paladini/harness-score) v1.12.0: **Level 4 (Self-correcting) — 105/105 (100%)**. L4 is the highest defined level.

| Dimension          | Current      |
| ------------------ | ------------ |
| Context & Guides   | 20/20 (100%) |
| Skills & Commands  | 17/17 (100%) |
| Hooks & Guardrails | 14/14 (100%) |
| Sensors & Feedback | 20/20 (100%) |
| CI Feedback        | 14/14 (100%) |
| Hygiene & Safety   | 20/20 (100%) |

## Scope and limits

The extension uses the page that is already open and signed in. Chrome manages the session cookies. Media URLs can contain temporary access tokens and are handled by the extension to request media, so keep them private. It supports finished, unencrypted videos. DRM-protected, encrypted, live, audio-only, and fragmented MP4 streams are outside its supported scope.

## Install for development

Prerequisites: Node.js 26.13.0 with npm and Google Chrome 120 or newer. Node.js 26.13.0 was available in the development environment for this release. Other Node.js versions have not been verified for this release. Install Node.js from [nodejs.org](https://nodejs.org/en/download), then check `node --version` and `npm --version`.

1. Run `npm ci` to install the locked project dependencies.
2. Run `npm run setup:hooks` to enable the repository's pre-commit checks.
3. Run `npm run build` to create the files in `dist/`.
4. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose this project folder.
5. Reload an open video or playlist tab so Chrome attaches the page detector. For unattended saves, turn off Chrome's **Ask where to save each file before downloading** setting in `chrome://settings/downloads`.

## Use

| Task                    | Steps                                                                                                                     | Result                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Download one video      | Play the video briefly. Open the extension popup. Choose a quality, subtitle, and output format. Select **Download**.     | MP4 is the default. MP4 saves a matching `.vtt` subtitle file when one is selected. MKV places the selected subtitle inside the video file. |
| Download a playlist     | Open a playlist page. Select **Scan**. Review the items on the Playlist page. Select the content and choose **Download**. | The extension creates folders from the playlist sections and saves each selected item in order.                                             |
| Stop and continue later | Select **Cancel** on the Downloader page. Change settings if needed. Select **Resume playlist**.                          | Completed items remain completed. The queue continues at the next unfinished item. Completed video pieces can be reused.                    |

## Key terms

| Term           | Meaning                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| HLS manifest   | A `.m3u8` file listing a video's quality options or sequential segments.                                                                          |
| Video stream   | One video shown in the popup. A stream can include several quality options.                                                                       |
| Segment        | One small sequential part of an HLS video.                                                                                                        |
| OPFS           | Chrome's private disk area for the extension. It holds temporary video pieces while a download runs.                                              |
| Remux          | FFmpeg copies the downloaded audio and video into MP4 or MKV without changing picture or sound quality.                                           |
| Playlist scan  | A background check that finds playlist items, videos, subtitles, and companion documents. A minimized worker window is used when a page needs it. |
| Playlist queue | The ordered list of playlist items waiting to download.                                                                                           |

## Playlist queue behaviour

Every item finishes with one result: **completed**, **cancelled**, or **failed**. A cancelled item remains unfinished and keeps the saved resume point. A failed item is classified so the queue can respond appropriately.

| Failure category | Meaning                                                                                                       | Queue behaviour                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Item             | One item has a broken or unsupported media asset.                                                             | Record the item failure and continue with the next item.                                                                       |
| Unauthorized     | The host returned HTTP 401 or 403, meaning the signed-in session could not access the media.                  | Stop after two consecutive access failures and preserve progress. Refresh the source page after signing in again, then resume. |
| Rate-limited     | The host returned HTTP 429 or 503, meaning it asked the extension to slow down or is temporarily unavailable. | Pause the queue immediately and preserve progress. Wait a few minutes, then resume.                                            |
| Engine           | The local download or FFmpeg engine could not finish.                                                         | Pause the queue and show the action needed before a resume.                                                                    |

The download coordinator records item outcomes. The playlist scanner discovers items and slows or stops when the host asks for fewer requests. These workflows have different retry policies. The [architecture map](docs/project-map.md) identifies their entry points.

## Architecture and engineering approach

The extension separates many reusable rules from browser workflows. Some `lib/` modules also interact with browser elements or network requests. [Architecture](docs/architecture.md) identifies those boundaries and their current limitations, and connects page-reader selection, message validation, and resume persistence to their owning areas and verification.

## Development commands

| Command                  | Purpose                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `npm run build`          | Build the extension and confirm every required browser file exists.            |
| `npm test`               | Run unit and integration tests.                                                |
| `npm run coverage:check` | Enforce coverage thresholds for reusable logic.                                |
| `npm run test:e2e`       | Run extension flows in Chromium through Playwright.                            |
| `npm run test:mutation`  | Insert small intentional code changes and require tests to detect each change. |
| `npm run format:check`   | Verify Prettier formatting.                                                    |
| `npm run lint`           | Run ESLint and HTMLHint with zero warnings allowed.                            |
| `npm run check:quality`  | Check duplicated and unused code.                                              |
| `npm run harness:score`  | Measure repository harness maturity using `harness-score`.                     |
| `npm run verify`         | Run the release verification pipeline.                                         |

## Documentation

| Topic                                                       | File                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| Architecture, patterns, boundaries, scanning, and downloads | [docs/architecture.md](docs/architecture.md)               |
| Download, save, and resume behaviour                        | [docs/download-and-resume.md](docs/download-and-resume.md) |
| Why key implementation choices were made                    | [docs/decisions.md](docs/decisions.md)                     |
| Test layers and required checks                             | [docs/testing-and-quality.md](docs/testing-and-quality.md) |
| Release summaries                                           | [docs/CHANGELOG.md](docs/CHANGELOG.md)                     |
| Security controls                                           | [SECURITY.md](SECURITY.md)                                 |
| Maintenance workflows and troubleshooting                   | [docs/maintenance.md](docs/maintenance.md)                 |
| Staged plan for preventing download regressions             | [docs/regression-plan.md](docs/regression-plan.md)         |
