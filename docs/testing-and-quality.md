# Testing and Quality

OPFS Media Packager uses several test layers because a passing unit test does not prove that Chrome pages, downloaded files, or bundled extension files work together.

New or changed test names should start with `should` and describe one observable behaviour. Some existing integration tests do not yet follow this convention. Tests use the same terms as the product: HLS manifest, video stream, subtitles, companion documents, playlist scan, playlist queue, and resume point.

## Test layers

| Layer       | Command                    | What it proves                                                                                           |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Unit        | `npm run test:unit`        | Checks individual `lib/` behaviours. Some tests supply mock browser objects or request functions.        |
| Integration | `npm run test:integration` | Several modules work together with a local server and mocked Chrome APIs.                                |
| Contract    | `npm run test:contract`    | Built files, manifest entries, HTML pages, documentation limits, and security expectations remain valid. |
| Browser     | `npm run test:e2e`         | A real Chromium extension flow works with Playwright.                                                    |
| Mutation    | `npm run test:mutation`    | Tests detect intentional small code changes, such as a reversed condition.                               |

The test pyramid keeps most tests fast at the unit layer. Integration and browser tests cover the connections that unit tests cannot observe. Mutation testing checks whether the tests would catch common implementation mistakes.

The `tests/unit/`, `tests/integration/`, and `tests/e2e/` directories contain those three layers. `tests/contract/` checks packaging, security, and documentation agreements, while `tests/architecture/` checks dependency boundaries. Shared integration and browser fixtures live in each layer's `fixtures/` directory. Coverage and mutation runs use these existing tests rather than a separate test layer.

## Test techniques and intent

| Technique                 | How it is used                                                                                                      | Value for maintenance and audit                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Test pyramid              | Most checks are unit tests. Integration, contract, browser, and mutation tests cover progressively wider behaviour. | Feedback stays fast while cross-boundary risks still have evidence.       |
| Characterization test     | A focused test records current behaviour before a risky legacy-code change.                                         | Maintainers can refactor with a known behavioural baseline.               |
| Seam creation             | A dependency on a browser API, clock, request, or storage boundary is isolated behind a small function or module.   | A test can control the dependency without a real browser or network host. |
| Contract test             | The test asserts an agreement between files or layers, such as a manifest entry that must point to a built script.  | Packaging and security regressions are caught before manual testing.      |
| Integration test          | Local servers and Chrome mocks run several real modules together.                                                   | Request, authorization, retry, and scan behaviour stays repeatable.       |
| End-to-end test           | Playwright loads the built extension in Chromium and follows user flows.                                            | The packaged extension is checked through Chrome's real interfaces.       |
| Mutation test             | Stryker changes a small expression or condition and runs relevant tests.                                            | A surviving change identifies an assertion gap or an untested branch.     |
| Risk-based test selection | Security boundaries, queue transitions, retries, downloads, and adapters receive unit plus wider-flow coverage.     | The most damaging regressions receive overlapping evidence.               |

## Required checks

| Command                      | Purpose                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                     | Install exactly the dependency versions recorded in `package-lock.json`.                                                  |
| `npm run build`              | Bundle every extension entry file and confirm browser pages reference existing files.                                     |
| `npm run format:check`       | Verify consistent formatting with Prettier.                                                                               |
| `npm run lint`               | Run ESLint and HTMLHint. Any warning fails the command.                                                                   |
| `npm run typecheck`          | Run strict TypeScript checks.                                                                                             |
| `npm test`                   | Run Node.js unit, integration, contract, and architecture tests.                                                          |
| `npm run coverage:check`     | Require 100% line coverage, at least 96% branch coverage, and at least 97% function coverage for `lib/`.                  |
| `npm run test:e2e`           | Run the real Chromium extension workflow. Run `npm run setup:e2e` once when Playwright's browser is missing.              |
| `npm run test:mutation`      | Run Stryker against the modules listed in `stryker.config.mjs`. The configured score threshold is 100%.                   |
| `npm run check:quality`      | Reject duplicated production code and unused code.                                                                        |
| `npm run check:architecture` | Check selected browser-global access and library dependencies on browser entry points.                                    |
| `npm run verify`             | Run build, formatting, lint, quality, type checks, Node tests, coverage and browser tests. Run mutation tests separately. |

## Test design rules

- Keep test files at or below 400 physical lines, including blank lines and comments. ESLint enforces the limit for test and spec files.
- Group unit tests by the module they exercise and name scenario files after the behaviour they cover.
- Extract shared mocks and large fixtures into the relevant layer's `fixtures/` directory. Keep test cases independent so the runner can execute test files in parallel.
- Start with a focused test around the rule that needs to change. This creates a safe seam in existing code before refactoring.
- Assert visible behaviour and meaningful state. Avoid asserting private implementation details unless they enforce a security or browser contract.
- Use local fake servers for network cases. They make authorization, rate-limit, retry, and timeout behaviour repeatable.
- Cover the success path, cancellation, one-item failure, session-wide failure, and resume behaviour for a playlist queue.
- Add a browser test when a change crosses extension pages, Chrome APIs, or a real download flow.
- Run mutation testing after changing protected logic. A surviving mutant means the test suite did not detect a plausible bug.

These practices follow the legacy-code workflow of first creating a seam, then writing a characterization test, then making the smallest safe change. They also support refactoring practices such as extracting focused methods, moving behaviour to the object that owns the data, replacing primitive flags with named types, and removing duplicate logic only after behaviour is covered.

## Code quality rules

The project uses strict TypeScript, immutable values where practical, small focused functions, and named domain types. Code should state the product concept it handles instead of using generic names such as `data`, `value`, or `result` when a more specific name exists.

ESLint limits branching complexity. jscpd detects copied production code. knip finds unused files, exports, types, and packages. These checks protect maintainers from hidden coupling and code that has no active owner.

The lint configuration also enforces the Object Calisthenics profile used by this functional TypeScript project. It rejects `let`, `var`, `else`, nested ternaries, parameter reassignment, deep nesting, and high cognitive complexity. Named context objects replace long parameter lists as the code is refactored. [Object Calisthenics profile](object-calisthenics.md) explains the complete profile and the rules that require design review.

## Release evidence and audit review

| Review question                                                                | Evidence                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Does a browser page accept untrusted data safely?                              | Security and message tests in `tests/`, the contract suite, and [security controls](../SECURITY.md).                     |
| Does an HLS download preserve segment order and recover after an interruption? | Segment and checkpoint tests in `tests/`, local integration tests, and browser download flows.                           |
| Does a playlist scan respect host request limits?                              | Playlist-probe integration tests cover one request in flight, `Retry-After`, and the repeated-429 circuit breaker.       |
| Can an implementation change evade the tests?                                  | `npm run test:mutation` requires Stryker to report zero surviving mutants in protected modules.                          |
| Can a packaging or documentation change break the extension?                   | The contract suite checks the manifest, built files, HTML, security requirements, anonymization, and documentation size. |

For a review, start with `npm run verify`. Run `npm run test:mutation` when core rules, security boundaries, queue transitions, or retry behaviour change. Keep the command output or continuous-integration record with the release evidence.

Coverage thresholds apply to `lib/**/*.ts` only. They do not measure `app.ts`, `background.ts`, or `page-playlist-probe.ts`. Mutation testing covers the modules explicitly listed in [stryker.config.mjs](../stryker.config.mjs). Passing a coverage threshold or a mutation run does not prove that every behaviour is correct.

The current browser suite uses local test media and simulated sites. It does not establish compatibility with every real site or prove audio and video synchronization across every player. When modifying packaging, inspect a representative output file and record the media format, duration and subtitle behaviour.

The documentation link test checks local paths in all Markdown files under `docs/` and rejects cross-file section links, which may not navigate in every preview. It does not validate external websites or whether documentation claims still match the implementation. A reviewer should compare changed claims with their referenced code and tests.

Related docs: [README](../README.md), [Architecture](architecture.md), [Decisions](decisions.md), and [Security](../SECURITY.md).
