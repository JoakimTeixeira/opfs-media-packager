---
description: "Use the repository's TypeScript architecture, test, and security conventions."
applyTo: "**/*.ts"
---

# TypeScript instructions

- Start from the module that owns the behavior and its colocated test. Read `AGENTS.md` and the relevant architecture docs when the boundary is unclear.
- Keep browser APIs, network requests, and persistent storage at their existing boundaries. Do not move browser-specific dependencies into reusable domain rules.
- Use explicit domain types, immutable values, and focused functions. Follow the configured lint rules; do not introduce `let`, `else`, nested ternaries, or unchecked assertions.
- Test observable behavior. Add or update tests for behavior changes, and use the smallest test layer that covers the changed boundary.
- Treat page data, messages, URLs, and stored values as untrusted. Do not put signed URLs, credentials, or session data in source, tests, logs, or docs.
- Do not weaken, skip, or delete checks to make a change pass.
