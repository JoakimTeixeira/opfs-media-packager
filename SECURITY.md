# Security controls

The project uses the OWASP Application Top 10 2025 from the Open Worldwide Application Security Project as a review reference. The controls below are implementation claims to verify during review. This document does not establish a complete compliance assessment.

| Risk area        | Control                                                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access control   | Privileged messages require an extension-page sender. Playlist messages also require a recognized track-page structure.                                                                                                    |
| Configuration    | Manifest V3 uses a self-only content security policy. A content security policy blocks inline and remote scripts that the extension did not package. Websites have no external-message API for calling extension handlers. |
| Dependencies     | The lock file pins dependency versions. FFmpeg is packaged with the extension. The extension loads no executable code from remote hosts.                                                                                   |
| Credentials      | Chrome manages session cookies. Media URLs can contain temporary access tokens and can pass through extension state and requests. Reject URLs with embedded user names or passwords and avoid sharing signed URLs.         |
| Injection        | Page values have a size limit and a validated shape. The UI uses `textContent`, which adds text without running it as HTML or script.                                                                                      |
| Network requests | Privileged requests accept public HTTP or HTTPS media URLs. Localhost and private-network IP addresses are rejected before a request runs.                                                                                 |
| Session use      | Chrome may use the current signed-in session for a playback request. The extension keeps that session inside Chrome.                                                                                                       |
| Integrity        | Validated messages, read-only download plans, integration tests, and mutation tests protect state changes and trust boundaries.                                                                                            |
| Errors           | Retries and cancellation are bounded. User messages describe the failed operation without exposing authorization values.                                                                                                   |

Run `npm run verify` before packaging. It builds the extension, checks formatting, runs TypeScript, JavaScript, and HTML validation, runs automated tests, enforces coverage, and launches the built extension in Chromium.

Run `npm run test:mutation` separately. Mutation testing inserts small intentional code changes into protected code. The command fails when a test suite does not detect every change.

## Evidence and limitations

On 2026-11-24, `npm audit` reported 10 moderate advisories in development dependencies. After updating the affected indirect dependencies, `npm audit` reported zero advisories. This check does not assess the security of bundled FFmpeg assets or prove that the extension has no vulnerabilities. Review development dependencies and run the project checks when changing their versions.

| Control                     | Code and tests                                                                                      | Review limit                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Message sender validation   | Message validation in [`lib/`](lib/) and its tests in [`tests/`](tests/)                            | Validate each new message handler and its sender at the privileged boundary.                                       |
| Media URL validation        | Media URL validation in [`lib/`](lib/) and its tests in [`tests/`](tests/)                          | Review redirects and new request paths separately. Tests do not prove every network destination is unreachable.    |
| Media request authorization | Media authorization in [`lib/`](lib/) and its tests in [`tests/`](tests/)                           | Rules are scoped to the selected media. Review changes to header handling and rule cleanup.                        |
| Broad site access           | [manifest.json](manifest.json) requests `<all_urls>` for detection and requests on supported sites. | This is broad browser permission. URL validation and message checks reduce risk but do not remove that permission. |
| Packaged scripts            | [manifest.json](manifest.json) defines the extension page content security policy.                  | The policy permits packaged WebAssembly via `wasm-unsafe-eval`. Review bundled code and dependency updates.        |
