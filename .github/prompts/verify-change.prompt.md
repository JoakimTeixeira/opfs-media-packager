---
name: Verify Change
description: Use when checking a completed code or documentation change before commit or merge.
argument-hint: "[file or behavior to verify]"
agent: agent
---

Review the current changes and identify the behavior they intend to change. Check that new or edited identifiers use clear, unabbreviated domain names and explicit types. Run focused tests first, then `npm run typecheck` and relevant lint or build checks. If the change crosses browser or module boundaries, run `npm test`. Run `npm run verify` when its prerequisites are available; if a repository-wide check blocks it, report that failure and still run the other relevant checks. Do not change unrelated code or weaken tests to make a check pass.
