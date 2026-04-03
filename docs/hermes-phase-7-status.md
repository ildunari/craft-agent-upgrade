# Hermes Phase 7 Status

**Status:** Implemented and locally verified on 2026-04-03  
**Implementation repo:** `/Users/kosta/LocalDev/.worktrees/craft-agents-oss/plugin-platform-spec`

## What shipped

Hermes is now integrated into Craft as a real external backend plugin.

That means:

- managed `craft-bridge` profile support
- external Hermes gateway support
- API-first transport through `/v1/responses`
- CLI fallback reserved for debugging and emergency local execution
- Craft-owned transcript recovery
- backend continuity stored separately from Craft's local session ids
- Hermes-native skills preserved as Hermes-owned behavior

## Final contract

Hermes Phase 7 settled on these rules:

- `supportsBranching=false`
- model selection is profile-default-first
- Hermes skills are not copied from Craft
- MCP config remains Craft-managed and restart-required when rewritten
- transcript recovery is host-owned because backend continuity cannot be treated as fully durable

## Why this matters

Hermes is the first fully implemented example of Craft's general external backend contract. It proves that Craft can add another runtime without turning that runtime into a special-case architecture.

The important pattern is:

- manifest-declared backend capability
- host-managed activation
- helper/runtime bridge
- backend-owned session pointer
- host-owned transcript and recovery

That pattern should be reused for future external runtimes.

## Verification highlights

The Hermes pass ended with all of these green locally:

- Hermes runtime and plugin-host activation tests
- Hermes helper API path tests
- Hermes transcript retry tests
- Hermes CLI fallback tests
- touched-package typechecks
- Electron build
- repo-wide `rtk bun run typecheck:all`
- repo-wide `rtk bun run test`

## Files to inspect in the implementation repo

Main code:

- `packages/server-core/src/plugins/hermes-runtime.ts`
- `packages/server-core/src/plugins/host.ts`
- `packages/shared/src/agent/backend/factory.ts`
- `packages/shared/src/agent/plugin-bridge-agent.ts`
- `packages/server-core/src/sessions/SessionManager.ts`
- `plugins/hermes/plugin.json`
- `plugins/hermes/main.mjs`

Main tests:

- `packages/server-core/src/plugins/__tests__/hermes-runtime.test.ts`
- `packages/server-core/src/plugins/__tests__/plugin-host.test.ts`
- `packages/server-core/src/sessions/create-managed-session.test.ts`
- `packages/shared/src/agent/__tests__/hermes-plugin.test.ts`

## Explicitly deferred

Still outside Phase 7:

- voice integration
- interactive MCP app UI
- rich live tool telemetry
- Craft-to-Hermes skill syncing
- broader per-turn model override policy
