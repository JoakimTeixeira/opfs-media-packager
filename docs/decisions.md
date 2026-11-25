# Engineering Decisions

This document records decisions that change how OPFS Media Packager behaves for users and maintainers.

Each entry states the problem, the chosen approach, and the observable result. The matching architecture pattern and code location are recorded in [architecture.md](architecture.md).

## Keep reusable rules outside browser pages

**Problem:** Earlier code mixed Chrome APIs, page HTML reading, and download rules in the same files. A change to a quality list could fail only after the extension ran.

**Decision:** Move many reusable rules into the TypeScript modules in [`lib/`](../lib/). Some modules also handle browser elements or network requests.

**Result:** Type checks and Node.js tests can catch certain mistakes before the browser workflow runs. Page-supplied data still needs runtime validation.

**Architecture technique:** Functional core and imperative shell is a useful direction for separating calculations from browser actions. The current `lib/` directory includes both kinds of code, so this separation is partial.

**Concrete example:** The page reads a requested parallel count and calls a shared rule to limit it. See the [reusable rule comparison](decision-examples/reusable-rules.md).

## Scan a playlist without disturbing the user

**Problem:** Opening a visible tab per item interrupted the user and sent too many requests to some media hosts.

**Decision:** Scan from the signed-in page first. Use a hidden same-site frame when a page needs browser rendering. The page request path spaces requests by at least 550 milliseconds and makes one retry after HTTP 429 or 503. It uses a bounded `Retry-After` delay and stops that scan after a second consecutive response.

**Result:** Playlist scanning stays in the background and gives the host time to recover. HTTP 429 means “too many requests”. HTTP 503 means the service is temporarily unavailable.

**Architecture technique:** Layered fallback with resilience controls. Each scan layer has a narrower browser capability than the next layer. The rate limiter, retry delay, and circuit breaker stop repeated calls after the host signals overload.

**Alternatives and trade-off:** Visible tabs provide a full page environment but can interrupt the user. Page requests are quieter but may miss content created only after rendering. Hidden frames and a minimized window provide fallback paths and add coordination complexity.

**Evidence and review trigger:** The playlist scanner in `src/` and the scan tests in [`tests/integration/`](../tests/integration/) cover pacing and repeated responses. Revisit the approach when a supported page requires a different execution environment or the host changes its request policy.

**Concrete example:** Two consecutive HTTP 429 responses stop the current scan. The [playlist scan sequence](decision-examples/playlist-scan-pacing.md) shows both requests and responses.

## Separate item results from failure categories

**Problem:** A broad `catch` block handled cancellation and failures together. It could mark a cancelled item as completed or continue through every item after the user's access had expired.

**Decision:** An item reports one outcome: `completed`, `cancelled`, or `failed`. A failed item has a category: `item`, `unauthorized`, `rate-limited`, or `engine`.

The download coordinator decides whether the playlist queue continues. The playlist scanner has a separate retry policy while finding items. An item failure affects one item, so the queue records it and continues. A classified rate-limit or engine failure pauses the queue. Two access failures in a row pause the queue because HTTP 401 and 403 indicate that the media request was refused.

**Result:** Cancelling keeps the exact unfinished item and resume state. One broken item does not block unrelated items. Session-wide access and rate-limit failures stop further requests before they repeat across the playlist.

**Architecture technique:** A discriminated union models valid item outcomes. A central policy function maps a typed failure category to one queue action. This is a finite-state model, not a broad exception handler that decides several unrelated behaviours.

**Trade-off and evidence:** Continuing after one refused request can attempt another item before the queue stops. Stopping at the first refusal would make an isolated media failure block the entire playlist. The queue policy in [`lib/`](../lib/) defines these decisions. The rule tests in [`tests/`](../tests/) and browser flows in [`tests/e2e/`](../tests/e2e/) cover failure decisions, cancellation, resume, rate limiting, and repeated access denial.

| Input                                    | Decision                       | Reason                                                                              |
| ---------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `completed`                              | Mark the item complete.        | Its output has been scheduled or verified.                                          |
| `cancelled`                              | Keep the item unfinished.      | A user cancellation must preserve the resume position.                              |
| `failed: item`                           | Record the error and continue. | The evidence applies to one item.                                                   |
| `failed: unauthorized` twice in sequence | Pause the queue.               | Two HTTP 401 or 403 responses indicate the current session cannot access the media. |
| `failed: rate-limited`                   | Pause the queue.               | More requests would violate the host's requested pacing.                            |
| `failed: engine`                         | Pause the queue.               | A local media engine issue needs user-visible remediation.                          |

**Example: preserve a cancelled item.** These short TypeScript examples illustrate the queue decision. They omit storage and error details.

Incorrect example. The catch block marks every interrupted item complete, including a user cancellation.

```ts
try {
  await downloadItem(item);
} catch {
  markCompleted(item);
}
```

Safer example. A typed item outcome lets the coordinator preserve the resume position when the person cancels.

```ts
const attempt = await runItem(item);
if (attempt.status === "cancelled") return "stop";
if (attempt.status === "completed") markCompleted(item);
```

The second example is illustrative and omits failure classification. See the [queue outcome example](decision-examples/playlist-queue-outcomes.md). The real queue policy also pauses after repeated access denial. The [download flow diagram](download-and-resume.md) shows how interrupted work relates to saved video parts.

## Store large downloads on disk while they run

**Problem:** Keeping thousands of video segments in browser memory could exhaust memory and lose completed work.

**Decision:** Save segments in OPFS, Chrome's private disk area for the extension. Save a checkpoint after each complete part and during cancellation or failure. FFmpeg reads those temporary files and copies the original audio and video into the requested MP4 or MKV file.

**Result:** A resumed download can reuse saved segments. The video keeps its original quality because FFmpeg repackages the streams without re-encoding them.

**Architecture technique:** Checkpointing with idempotent retry. The checkpoint stores verified completed parts. The stable resume key excludes rotating temporary URL tokens, allowing the same logical video to find its saved parts after a new signed URL is issued.

**Alternatives and limits:** Keeping the full video in memory increases memory pressure. A native helper requires installation outside Chrome. The chosen browser storage still depends on available disk space and browser storage rules. When that storage is unavailable, the code has a memory-backed fallback that may be unsuitable for large videos. Review the decision if browser storage or supported file sizes change.

**Evidence:** The download coordinator in `src/`, checkpoint rules in [`lib/`](../lib/), and checkpoint and resume tests in [`tests/`](../tests/).

**Concrete example:** A resumed download validates saved parts before deciding what to fetch. See the [checkpoint flow](decision-examples/large-downloads-and-checkpoints.md).

## Keep preferences consistent for a playlist download

**Problem:** A retry could use older quality, format, or concurrency choices. Cancelling a playlist could lose the remaining items.

**Decision:** Save quality, output format, and parallel segment preferences in the active playlist plan and Chrome session storage. Store queue progress as items complete, cancel, or fail.

**Result:** A resumed playlist uses the current settings for unfinished items and skips files that Chrome still confirms as downloaded.

**Architecture technique:** Explicit application state. Playlist-plan preferences and queue progress are persisted independently from transient user interface controls. A page refresh can rebuild the view from the saved state.

**Trade-off and evidence:** Chrome session storage is available to extension contexts for the browser session. It is not a permanent backup across all browser restarts or storage clearing. The browser tests in [`tests/e2e/`](../tests/e2e/) cover updated preferences and playlist resume. Revisit persistence requirements if users need recovery after a full browser restart.

**Concrete example:** Retrying a playlist reads the saved output format. See the [preference comparison](decision-examples/playlist-download-preferences.md).

## Select adapters from page structure

**Problem:** Website names in code make the extension depend on a specific provider.

**Decision:** Match stable route and page structures through the page adapters in [`lib/`](../lib/). Keep provider names out of source, tests, and documentation.

**Result:** Playlist detection works across equivalent page structures while the code stays independent of provider branding.

**Architecture technique:** Adapter pattern. The adapter selector routes a page to the smallest compatible reader. A new supported structure belongs in a new adapter and its tests, leaving existing adapters unchanged.

**Alternative and limitation:** A fixed list of site hostnames is simple to recognize but does not cover custom domains. Route matching supports those domains, yet a matching route alone does not prove that the page has a supported playlist structure. Review page parsing and tests when a supported site changes its layout.

**Evidence:** Page adapters in [`lib/`](../lib/) and detection tests in [`tests/`](../tests/) and [`tests/integration/`](../tests/integration/).

**Example: select a reader from the page route.** This example runs from the project root with Node.js and uses fictional URLs. A supported route selects the same reader on different hosts. An unrelated route returns `null`.

```ts
import { playlistAdapterId } from "./lib/playlist/playlist-adapters.ts";

playlistAdapterId("https://media.example/c/topic/sections/1/lessons/2");
// "sidebar-playlist"
playlistAdapterId("https://learning.example/c/topic/sections/1/lessons/2");
// "sidebar-playlist"
playlistAdapterId("https://media.example/about");
// null
```

Route selection only chooses the reader. The page still needs compatible content for playlist detection to succeed. See the [host-based comparison](decision-examples/playlist-page-adapters.md).

## Keep credentials inside Chrome

**Problem:** Some video hosts require the current page referrer and browser session to load media.

**Decision:** Use scoped Chrome network rules and page-context requests. Validate every page value before it reaches storage or downloads.

**Result:** The signed-in session can load its own media while the extension does not export cookies or access tokens.

**Architecture technique:** Anti-corruption layer and defense in depth. External page values cross validated message boundaries. Browser request rules are short-lived and scoped to the selected media request.

**Alternative and limitation:** Asking the user to export browser credentials would add sensitive handling and setup. The extension relies on the user's browser session. A host can still reject a request because of its own access policy, expired signed URLs, cookies or headers.

**Evidence:** Media authorization and request rules in [`lib/`](../lib/) and their tests in [`tests/`](../tests/). Revisit the design when Chrome changes request rules or a supported host changes its authorization mechanism.

**Concrete example:** An untrusted media URL is checked before the extension requests it. See the [media access flow](decision-examples/media-access-and-credentials.md).

## Extension rules for maintainers

| Change                                | Required place to extend                                                                     | Minimum evidence                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Support a new playlist page structure | Add a route or structure adapter and keep provider names out of the code.                    | Adapter unit test, realistic probe integration test, and popup flow test when the UI changes. |
| Add page-supplied data                | Add a named type and validate it at the content or background message boundary.              | Invalid input tests plus a trusted-input flow test.                                           |
| Add a queue failure class             | Extend the typed failure union, central policy, user message, and resume behaviour together. | Tests for the failure classification, queue action, cancellation, and retry state.            |
| Add persisted download state          | Define the immutable stored shape and a validator before reusing it.                         | Corrupt, stale, complete, and interrupted-state tests.                                        |
| Add a user preference                 | Define one default in the preference module and read it through the shared preference API.   | Default, migration, popup, playlist, and downloader tests when each screen exposes it.        |

These rules prevent a behaviour change from requiring scattered edits. They make the module that owns the domain concept the single place that defines its value and policy.

Related docs: [README](../README.md), [Architecture](architecture.md), [Testing and quality](testing-and-quality.md), and [Changelog](CHANGELOG.md).
