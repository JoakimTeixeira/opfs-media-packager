# Agent guide

## Project overview

OPFS Media Packager is a local-first Chrome Manifest V3 extension for saving authorized HLS or direct video, subtitles, and companion documents. It uses Chrome APIs, OPFS, and bundled FFmpeg; DRM-protected and live media are outside the supported scope.

## Setup and verification

- Install the locked dependencies with `npm ci`.
- Build the extension with `npm run build`.
- Run focused unit tests with `npm run test:unit` and integration tests with `npm run test:integration`.
- Run all Vitest tests with `npm test`; run browser flows with `npm run test:e2e` after `npm run setup:e2e` if Chromium is missing.
- Run `npm run verify` for build, formatting, lint, quality, type checks, tests, coverage, and browser checks. Run mutation tests separately with `npm run test:mutation`.
- Measure agent-harness maturity with `npm run harness:score`.

## Architecture

- Browser entry points and extension UI live in `src/`.
- Reusable domain rules and their colocated tests live in `lib/`.
- Cross-module integration, contract, architecture, and browser tests live in `tests/`.
- Read `docs/project-map.md` and `docs/architecture.md` to locate owners and boundaries before changing behavior.
- Keep browser APIs, network access, and persistent storage at their existing boundaries; do not move browser-specific dependencies into pure domain rules.

## Engineering conventions

- Use strict TypeScript and the existing Vitest, ESLint, HTMLHint, and Prettier configurations.
- Name tests for observable behavior and add or update coverage for behavior changes.
- Prefer focused changes within the module that owns the behavior. Preserve public APIs unless a requested behavior requires a change.
- Keep documentation aligned with the implementation and link to existing guidance instead of copying it.
- Do not weaken, skip, or remove checks to make verification pass.

## Security and generated assets

- Treat page content, media URLs, messages, and stored values as untrusted input; preserve the validation at their existing boundaries.
- Do not publish signed media URLs, session data, credentials, or personal data in source, tests, logs, or documentation.
- Do not modify bundled third-party assets under `vendor/` unless the task specifically concerns their update.
- Treat `dist/`, `coverage/`, `reports/`, and `test-results/` as generated output; do not commit them unless a task explicitly requires it.
