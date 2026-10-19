// @talia/authoring-core — barrel. Framework-agnostic: never import React/DOM/
// browser globals here. Consumed by the editor (via src/lib + src/types shims)
// and future CLI/MCP. See ../../docs/adr-authoring-tooling.md + the extraction
// assessment. Tier A (pure invariants) lives here; Tier B mutation ops land under
// ./ops later.
export * from './model'
export * from './invariants/effectsHelpers'
export * from './invariants/interactionTemplates'
export * from './invariants/choicePresentation'
export * from './invariants/gestureStyles'
export * from './invariants/moderation'
export * from './invariants/interactionSchema'
export * from './invariants/choiceNodeRefs'
export * from './validation'
