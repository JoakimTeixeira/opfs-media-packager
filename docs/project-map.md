# Project map

| Path                                           | Responsibility                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/background.ts`                            | Tracks media requests, coordinates scans, and applies temporary request rules. |
| `src/content.ts` and `src/page-track-probe.ts` | Read page structure, detect players, and scan track topics.                    |
| `src/popup.ts` and `src/popup.html`            | Show detected video streams and start a single download or track scan.         |
| `src/track.ts` and `src/track.html`            | Let the user select track topics and track download settings.                  |
| `src/app.ts` and `src/index.html`              | Download segments, resume work, package media, and show progress.              |
| `lib/`                                         | Reusable rules and their colocated unit tests.                                 |
| `vendor/ffmpeg/`                               | Bundled FFmpeg code used to package downloaded media.                          |
| `tests/`                                       | Integration, browser, contract, and architecture tests, grouped by layer.      |

Related docs: [README](../README.md), [Decisions](decisions.md), [Testing and quality](testing-and-quality.md), and [Security](../SECURITY.md).
