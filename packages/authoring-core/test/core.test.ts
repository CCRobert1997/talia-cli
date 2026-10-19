// Contract tests for @talia/authoring-core — the logic invariants the editor AND the
// future CLI both depend on. Pure (no DB): run with `npm test` (tsx + node:test).
// Live schema-drift diffing (core columns == live Postgres) needs DB access and a
// schema RPC — tracked as a follow-up; these guard the pure authoring logic.
import { test } from 'vitest'
import assert from 'node:assert/strict'

import {
  writePresentation,
  parsePresentation,
  hasNonPresentationInteraction,
  normalizePresentation,
  isValidSkin,
} from '../src/invariants/choicePresentation'
import { withRejectedToDraftFlip } from '../src/ops/projects'
import { needsFullscreenFallback } from '../src/ops/publish'
import { buildNewNode } from '../src/ops/nodes'
import { effectMatchesBool, setOrReplaceBoolEffect } from '../src/invariants/effectsHelpers'

// ── choice presentation: the carrier-safety invariant (a styled normal/paid button
//    must never gain a mode/template that would misroute it into gesture/template
//    rendering on the player). ────────────────────────────────────────────────────
test('presentation-only interaction never carries mode/template', () => {
  const w = writePresentation(null, normalizePresentation({ anchor: 'bar', skin: 'preset:gilded', size: 'm' }))
  assert.deepEqual(Object.keys(w!), ['presentation'])
  assert.ok(!('mode' in w!) && !('template' in w!))
})

test('a presentation equal to the default bar button collapses to null', () => {
  assert.equal(writePresentation(null, normalizePresentation({ anchor: 'bar', skin: 'default', size: 'm' })), null)
})

test('presentation coexists with a template without clobbering it', () => {
  const w = writePresentation({ template: 'hotspot_collect', params: { needK: 3 } },
    normalizePresentation({ anchor: 'frame', skin: 'preset:film', size: 'l', pos: { x: 0.2, y: 0.6 }, w: 0.4 }))
  assert.ok('template' in w! && 'presentation' in w!)
  const cleared = writePresentation(w, null)
  assert.deepEqual(Object.keys(cleared!).sort(), ['params', 'template'])
})

test('hasNonPresentationInteraction distinguishes gesture/template from presentation-only', () => {
  assert.equal(hasNonPresentationInteraction({ presentation: { skin: 'default' } }), false)
  assert.equal(hasNonPresentationInteraction({ mode: 'swipe' }), true)
})

test('normalize clamps pos/w and whitelists skin/size', () => {
  const n = normalizePresentation({ anchor: 'frame', skin: 'preset:BOGUS', size: 'xl', pos: { x: 9, y: -9 }, w: 5 })
  assert.equal(n.skin, 'default')
  assert.equal(n.size, 'm')
  assert.deepEqual(n.pos, { x: 1, y: 0 })
  assert.equal(n.w, 1)
})

test('image skin validity', () => {
  assert.equal(isValidSkin('image:https://x/y.png'), true)
  assert.equal(isValidSkin('image:nope'), false)
  assert.equal(isValidSkin('preset:gilded'), true)
  assert.equal(parsePresentation({ presentation: { skin: 'preset:film' } })?.skin, 'preset:film')
})

// ── project moderation invariant (A4) ────────────────────────────────────────────
test('editing a rejected project flips it to draft, clearing rejection fields', () => {
  const p = withRejectedToDraftFlip('rejected', { title: 'x' })
  assert.equal(p.status, 'draft')
  assert.equal(p.last_rejection_reason_category, null)
})

test('rejected flip does not fight an explicit status set (e.g. publish)', () => {
  const p = withRejectedToDraftFlip('rejected', { status: 'pending_review' })
  assert.equal(p.status, 'pending_review')
})

test('non-rejected projects are untouched', () => {
  const p = withRejectedToDraftFlip('published', { title: 'x' })
  assert.equal(p.status, undefined)
})

// ── publish fallback predicate ────────────────────────────────────────────────────
test('needsFullscreenFallback: template + no region → true; with region or no template → false', () => {
  assert.equal(needsFullscreenFallback({ template: 'combo_rated' }, null), true)
  assert.equal(needsFullscreenFallback({ template: 'combo_rated' }, { w: 0.5, h: 0.5 }), false)
  assert.equal(needsFullscreenFallback({ mode: 'swipe' }, null), false)
  assert.equal(needsFullscreenFallback(null, null), false)
})

// ── node builder ─────────────────────────────────────────────────────────────────
test('buildNewNode mints a draft node with meta and rounded canvas coords', () => {
  const { dbFields, node } = buildNewNode({ projectId: 'p1', x: 12.7, y: -3.2, title: 'T' })
  assert.equal(node.status, 'draft')
  assert.equal(node.title, 'T')
  assert.equal(node.canvas_x, 13)
  assert.equal(node.canvas_y, -3)
  assert.equal((dbFields as { id: string }).id, node.id)
  assert.equal(node.meta?.node_id, node.id)
})

// ── effects DSL (tolerant bool matching) ─────────────────────────────────────────
test('effectMatchesBool tolerates legacy int/string bool values', () => {
  assert.equal(effectMatchesBool({ var_id: 'v', op: 'set', value: true }, 'v', true), true)
  const eff = setOrReplaceBoolEffect([], 'v', true)
  assert.equal(eff.length, 1)
  assert.equal(effectMatchesBool(eff[0], 'v', true), true)
})
