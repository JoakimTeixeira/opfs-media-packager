# Project map

| Path                                              | Responsibility                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/background.ts`                               | Tracks media requests, coordinates scans, and applies temporary request rules. |
| `src/content.ts` and `src/page-playlist-probe.ts` | Read page structure, detect players, and scan playlist items.                  |
| `src/popup.ts` and `src/popup.html`               | Show detected video streams and start a single download or playlist scan.      |
| `src/playlist.ts` and `src/playlist.html`         | Let the user select playlist items and playlist download settings.             |
| `src/app.ts` and `src/index.html`                 | Download segments, resume work, package media, and show progress.              |
| `lib/`                                            | Reusable rules and their colocated unit tests.                                 |
| `vendor/ffmpeg/`                                  | Bundled FFmpeg code used to package downloaded media.                          |
| `tests/`                                          | Integration, browser, contract, and architecture tests, grouped by layer.      |

Related docs: [README](../README.md), [Decisions](decisions.md), [Testing and quality](testing-and-quality.md), and [Security](../SECURITY.md).
