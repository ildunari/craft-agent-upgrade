# Craft Plugin Platform Standard

**Status:** Current reference  
**Last updated:** 2026-04-03  
**Canonical implementation example:** Hermes backend plugin in `craft-agents-oss`

## Why this doc exists

Craft now has a real plugin platform shape, not just scattered extension seams. This document is the portable reference for how to add:

- new agent or backend runtimes
- new settings panes and route pages
- new session, composer, or chat surfaces
- future richer plugin-owned features such as custom tool UIs and MCP app providers

The important rule is consistency: future work should fit the shared capability system instead of introducing plugin-specific side channels.

## Core model

Craft's plugin platform has three layers:

1. **Host control plane**
   The Electron/main-process plugin host owns discovery, compatibility checks, activation, quarantine, persistence, and backend registration.

2. **Shared capability vocabulary**
   Plugin capabilities are typed in `packages/shared/src/plugins/types.ts`. This is the one extension language for both runtime and UI contributions.

3. **Renderer projection**
   The renderer consumes host-projected capabilities and renders them into approved surfaces like settings panes, actions, and chat cards.

## Capability taxonomy

Current capability types are:

- `backend`
- `routingPolicy`
- `sourceConnector`
- `settingsPane`
- `routePage`
- `sessionAction`
- `composerAction`
- `chatCardType`
- `eventEnricher`
- `taskProvider`
- `automationProvider`
- `voiceInputProvider`
- `speechOutputProvider`
- `mcpAppProvider`

If a future feature does not fit one of these well, extend the shared type system first. Do not bolt a custom plugin API onto one subsystem.

## Platform rules

### The host owns lifecycle and safety

Plugins do not own app lifecycle. The host decides:

- whether a plugin is compatible
- whether it is enabled or quarantined
- how its permissions are interpreted
- which contributions become active surfaces

### Session identity stays in Craft

Local Craft session ids are host state. Backend runtimes may keep their own continuity pointers, but those belong in backend session state, not in Craft's local session id fields.

### UI surfaces stay host-shaped

Plugins can contribute a settings pane, route page, action, or chat card type, but the host still controls where and how those surfaces appear. This keeps the app coherent and keeps safety, navigation, and persistence rules centralized.

## Standard pattern for a backend plugin

Use a `backend` capability when the plugin adds a runtime like Hermes or another agent framework.

The standard path is:

1. create a plugin manifest with a backend contribution id
2. add helper/runtime code
3. activate it through the plugin host
4. register through the shared external backend registration seam
5. store backend continuity in backend state, not local Craft session ids
6. add bridge, host, session, and verification coverage

Hermes is the first full example of this pattern.

## Standard pattern for UI extensions

### Settings panes

Use `settingsPane` when the feature needs bounded configuration UI.

### Route pages

Use `routePage` when the feature needs a host-approved navigable page.

### Session and composer actions

Use `sessionAction` or `composerAction` for focused commands, not broad escape hatches.

### Chat cards

Use `chatCardType` when a plugin wants structured presentation inside the transcript based on typed match rules.

### Richer future surfaces

Use `mcpAppProvider` or a future capability extension when the feature is more like an app surface than a static action or page, but only after host lifecycle and safety support exists.

## What is stable now

Production-ready enough to build on:

- plugin manifest loading
- capability registry
- enable/disable/quarantine state
- external backend registration
- renderer projection for actions and chat cards
- Hermes as a working external backend plugin

Future-facing and still staged:

- broader routing policies
- source connector ecosystem growth
- task and automation providers
- voice providers
- richer MCP app surfaces

## Testing rule

A plugin feature is not complete until the layer it touches has tests:

- shared types or manifest parsing
- host activation and persistence
- backend/session behavior when relevant
- renderer projection if the user can see it

## Bottom line

Craft should be extended through one plugin platform with one shared capability vocabulary. Hermes is the first real proof that the architecture works for external runtimes, and the same contract should now be used for other agents, UI surfaces, and future plugin-owned product features.
