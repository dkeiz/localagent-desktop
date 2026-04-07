# Test Layout

## Purpose
This directory is the refactor-safe test backbone for LocalAgent.

The goal is to catch seam breakage before large modules are split:
- renderer bridge drift
- widget DOM drift
- plugin lifecycle regressions
- MCP registry regressions
- knowledge safety regressions
- file-size budget regressions

## Suites
- `npm run test:contracts`
  Static and contract-level checks. Fastest signal.
- `npm run test:quick`
  Contract suite plus fast legacy integration scripts.
- `npm run test:core`
  Quick suite plus headless app smoke and mocked IPC flow.
- `npm run test:live`
  Environment-dependent live checks.
- `npm run test:all`
  Core plus live.
- `npm run verify`
  Alias for `test:core`.

## Structure
- `contracts/`
  Refactor guards and interface contracts.
- `helpers/`
  Shared assertions, fakes, and renderer inspection utilities.
- `fixtures/`
  Contract manifests and temporary policy files.

## Rules
1. Add a contract test before splitting a high-risk seam.
2. Keep tests deterministic and local-first.
3. Put live or environment-dependent checks behind explicit suites.
4. If a bug is fixed, add or extend a contract test for it.
