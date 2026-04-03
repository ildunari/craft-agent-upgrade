# Phase 7 Cleanup Ledger

**Date:** 2026-04-03  
**Purpose:** Record the blocker-removal work that turned the Hermes branch into a locally clean repo state

## Hermes implementation issues

These were Hermes-adjacent or bridge-adjacent problems fixed in the same implementation pass:

- backend continuity was being conflated with Craft local session identity
- Hermes needed explicit host-prepared runtime registration
- helper-backed backends needed recovery-message support for transcript-based retry

## Pre-existing repo blockers

These issues were discovered as part of wider verification and were promoted into the cleanup pass because they blocked repo-wide confidence:

- `apps/electron/src/transport/routed-client.ts`
  reconnect listener teardown bug during client swaps
- `packages/server/src/__tests__/smoke.test.ts`
  headless smoke test collisions with the real `~/.craft-agent` lock/config directory
- `packages/shared/src/agent/mode-manager.ts`
  safe-mode developer-feedback permission regression
- `apps/electron/src/main/browser-pane-manager.ts` and its tests
  teardown/test drift issues causing repeated failures
- `apps/electron/src/main/__tests__/session-branch-rollback.isolated.ts`
  stale config-module mocking behavior
- `packages/session-tools-core/tsconfig.json`
  invalid root config inheritance path blocking repo-wide typecheck

## Resolved during pass

### Runtime and transport

- fixed routed-client reconnect teardown so workspace swaps do not trip over an uninitialized unsubscribe handle
- hardened browser-pane-manager close cleanup so cleanup failures do not crash final teardown

### Safety and permissions

- restored explicit safe-mode allowance for developer feedback tool flow

### Test and harness stability

- isolated smoke tests from the user's live Craft config directory
- updated transport expectation wording to match current real failure strings
- repaired browser-pane-manager test harness behavior around toolbar load, replay, and destruction
- fixed isolated branch rollback mocks to use the real shared config exports as a base

### Typecheck health

- corrected `packages/session-tools-core/tsconfig.json` to extend the actual repo root config used by the current workspace

## Final verification outcome

The pass ended with:

- Hermes-local gates green
- repo-wide `rtk bun run typecheck:all` green
- repo-wide `rtk bun run test` green

No blocker remained open at the end of the local verification cycle.
