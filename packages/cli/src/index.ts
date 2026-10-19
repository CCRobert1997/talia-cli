#!/usr/bin/env node
// talia — authoring CLI (ADR-001 phase 3 skeleton). A thin shell over
// @talia/authoring-core ops: the same invariant-safe authoring the editor performs,
// scriptable + agent-callable. Runs on Node 22 native TS (no build step).
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { login, getAuthedClient } from './client'
import { clearSession, loadSession } from './config'
import { nodeTransport, mimeFor } from './transport'
import { uploadAsset, deleteAssetRow, inferKindFromName } from '@talia/authoring-core/ops/assets'
import { insertProject, updateProjectRow, deleteProjectCascade } from '@talia/authoring-core/ops/projects'
import { buildNewNode, insertNode, updateNodeRow } from '@talia/authoring-core/ops/nodes'
import { insertChoice, updateChoiceRow, deleteChoiceRow } from '@talia/authoring-core/ops/choices'
import { normalizePresentation, writePresentation } from '@talia/authoring-core/invariants/choicePresentation'
import { serializeInteraction, type AnchorMode } from '@talia/authoring-core/invariants/interactionSchema'
import { defaultParamsFor } from '@talia/authoring-core/invariants/interactionTemplates'
import { insertVariable, deleteVariableRow } from '@talia/authoring-core/ops/variables'
import { insertAchievement, deleteAchievementRow } from '@talia/authoring-core/ops/achievements'
import { publishProject } from '@talia/authoring-core/ops/publish'
import { buildValidationContext, runValidation } from '@talia/authoring-core/validation'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Project, StoryNode, Choice, Variable, Achievement, VarType } from '@talia/authoring-core/model'
import { parseThemeBg, THEME_BG_PRESETS } from '@talia/authoring-core/model'

const HELP = `talia — Talia authoring CLI

Usage:
  talia login [email] [password]     Log in (falls back to TALIA_EMAIL / TALIA_PASSWORD)
  talia whoami                       Show the logged-in creator
  talia logout                       Forget the saved session
  talia projects                     List your projects
  talia project new <title>          Create a draft project
  talia project rm <projectId>       Delete a project (cascade)
  talia node add <projectId>         Add a blank node to a project
  talia node set <nodeId> <title|video|image|auto> <value>
  talia node start <projectId> <nodeId>        Set the project Start node
  talia choice add <nodeId> [label] [targetNodeId]
  talia choice set <choiceId> <label|target> <value>
  talia choice present <choiceId> '<presentation json>'   Skin/font/size/pos
  talia choice tap <choiceId> <x> <y> <w> <h> [hint]      Tap region (0..1)
  talia choice interaction <choiceId> '<template json>'   Advanced interaction template
  talia choice rm <choiceId>
  talia choices <nodeId>             List a node's choices
  talia var add <projectId> <name> <bool|int> [default]
  talia vars <projectId>             List variables
  talia var rm <varId>
  talia ach add <projectId> <name> <emoji> [description]
  talia achs <projectId>             List achievements
  talia ach rm <achId>
  talia asset upload <projectId> <file>        Upload media to R2 + register
  talia assets <projectId>           List a project's assets
  talia asset rm <assetId>
  talia import-outline <projectId> <file.md>   Build nodes + choices from an outline
  talia validate <projectId>         Run publish validation (rule ids + severity)
  talia publish <projectId>          Backfill fallback regions + publish_project
  talia help

Global flag:
  --json   Machine-readable output: read commands print one JSON line (the rows),
           write commands print {"ok":true,"id":"…"}. For agents. (validate still
           exits 2 when there's an error-severity issue.)

Outline format (import-outline):
  # Node Title
  - Choice label -> Target Node Title
  (first node becomes the project Start; unknown targets are left unset + warned)

Config: SUPABASE_URL / SUPABASE_ANON_KEY (or ~/.talia/config.json). RLS scopes
everything to the logged-in owner.`

function die(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

// Supabase errors are plain objects ({ message, details, hint, code }), not Error
// instances — extract a readable message.
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    return [o.message, o.details, o.hint, o.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(e)
  }
  return String(e)
}

async function main(): Promise<void> {
  // `--json` (anywhere in argv) switches read commands to a single JSON line and
  // write commands to `{ ok, id }`, so agents parse structured output instead of
  // the human text. Filter it out before positional parsing.
  const argv = process.argv.slice(2)
  const jsonMode = argv.includes('--json')
  const [cmd, sub, ...rest] = argv.filter(a => a !== '--json')
  // Dual output: JSON line in --json mode, else run the human-readable printer.
  const emit = (data: unknown, human: () => void): void => {
    if (jsonMode) console.log(JSON.stringify(data))
    else human()
  }
  // Write-command acknowledgement: `{ ok, id, ...extra }` in --json mode, else text.
  const ok = (id: string | null, humanText: string, extra?: Record<string, unknown>): void =>
    emit({ ok: true, id, ...(extra ?? {}) }, () => console.log(humanText))

  switch (cmd) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      console.log(HELP)
      return

    case 'login': {
      const email = sub ?? process.env.TALIA_EMAIL
      const password = rest[0] ?? process.env.TALIA_PASSWORD
      if (!email || !password) die('Provide email + password (args) or set TALIA_EMAIL / TALIA_PASSWORD.')
      const user = await login(email, password)
      ok(null, `✓ Logged in as ${user.email}`, { email: user.email })
      return
    }

    case 'whoami': {
      const s = loadSession()
      if (!s?.access_token) die('Not logged in. Run: talia login')
      const { user } = await getAuthedClient()
      emit({ id: user.id, email: user.email }, () => console.log(`${user.email} (${user.id})`))
      return
    }

    case 'logout':
      clearSession()
      ok(null, '✓ Logged out')
      return

    case 'projects': {
      const { client } = await getAuthedClient()
      const { data, error } = await client.from('projects').select('*').order('updated_at', { ascending: false })
      if (error) die(error.message)
      const projects = (data ?? []) as Project[]
      emit(projects, () => {
        for (const p of projects) console.log(`${p.id}  [${p.status}]  ${p.title}`)
        if (!projects.length) console.log('(no projects)')
      })
      return
    }

    case 'project': {
      if (sub === 'new') {
        const title = rest.join(' ').trim()
        if (!title) die('Usage: talia project new <title>')
        const { client, user } = await getAuthedClient()
        const p = await insertProject(client, user.id, title)
        ok(p.id, `✓ Created ${p.id}  ${p.title}`, { title: p.title })
        return
      }
      if (sub === 'rm') {
        const projectId = rest[0]
        if (!projectId) die('Usage: talia project rm <projectId>')
        const { client } = await getAuthedClient()
        await deleteProjectCascade(client, projectId)
        ok(projectId, '✓ Deleted')
        return
      }
      if (sub === 'theme') {
        // talia project theme <projectId> <presetId | clear | custom "#RRGGBB,#RRGGBB[,…]" [dark]>
        const projectId = rest[0]
        const arg = rest[1]
        if (!projectId || !arg) {
          die(`Usage: talia project theme <projectId> <preset|clear|custom>\n  preset ids: ${THEME_BG_PRESETS.join(' | ')}\n  clear:  talia project theme <id> clear\n  custom: talia project theme <id> custom "#RRGGBB,#RRGGBB" [dark]`)
        }
        let candidate: unknown
        if (arg === 'clear' || arg === 'none') {
          candidate = null
        } else if (arg === 'custom') {
          const colors = (rest[2] ?? '').split(',').map(s => s.trim()).filter(Boolean)
          const dark = rest[3] === 'dark' ? true : rest[3] === 'light' ? false : undefined
          candidate = dark === undefined ? { colors } : { colors, dark }
        } else {
          candidate = { preset: arg } // validated against the preset whitelist below
        }
        const parsed = parseThemeBg(candidate)
        if (!parsed.ok) die(parsed.error) // reuses the same core guard as the editor
        const { client } = await getAuthedClient()
        await updateProjectRow(client, projectId, { theme_bg: parsed.value })
        ok(projectId, parsed.value ? `✓ Theme set: ${JSON.stringify(parsed.value)}` : '✓ Theme cleared (player default)', { theme: parsed.value })
        return
      }
      die('Unknown project subcommand. Try: new | rm | theme')
      return
    }

    case 'node': {
      if (sub === 'add') {
        const projectId = rest[0]
        if (!projectId) die('Usage: talia node add <projectId>')
        const { client } = await getAuthedClient()
        const { dbFields, node } = buildNewNode({ projectId, x: 0, y: 0, title: 'Untitled node' })
        const { error } = await insertNode(client, dbFields)
        if (error) die(String((error as { message?: string }).message ?? error))
        ok(node.id, `✓ Added node ${node.id}`)
        return
      }
      if (sub === 'set') {
        const [nodeId, field, ...valueParts] = rest
        const value = valueParts.join(' ')
        if (!nodeId || !field) die('Usage: talia node set <nodeId> <title|video|image|auto> <value>')
        const { client } = await getAuthedClient()
        const patch =
          field === 'title' ? { title: value } :
          field === 'video' ? { video_url: value, media_type: 'video' as const } :
          field === 'image' ? { image_urls: [value], media_type: 'images' as const } :
          field === 'auto'  ? { auto_advance: value === 'true' } :
          null
        if (!patch) die('field must be title | video | image | auto')
        await updateNodeRow(client, nodeId, patch)
        ok(nodeId, '✓ Updated')
        return
      }
      if (sub === 'start') {
        const [projectId, nodeId] = rest
        if (!projectId || !nodeId) die('Usage: talia node start <projectId> <nodeId>')
        const { client } = await getAuthedClient()
        await updateProjectRow(client, projectId, { start_node_id: nodeId })
        ok(nodeId, '✓ Start node set', { projectId })
        return
      }
      die('Unknown node subcommand. Try: add | set | start')
      return
    }

    case 'validate': {
      const projectId = sub
      if (!projectId) die('Usage: talia validate <projectId>')
      const { client } = await getAuthedClient()
      const [proj, nodes, choices, variables, achievements] = await loadProject(client, projectId)
      const ctx = buildValidationContext(proj, nodes, choices, variables, achievements)
      const issues = runValidation(ctx)
      const hasError = issues.some(i => i.severity === 'error')
      emit({ ok: !hasError, issues }, () => {
        if (!issues.length) { console.log('✓ No issues — ready to publish'); return }
        for (const i of issues) {
          const where = [i.nodeId && `node=${i.nodeId.slice(0, 8)}`, i.choiceId && `choice=${i.choiceId.slice(0, 8)}`].filter(Boolean).join(' ')
          console.log(`[${i.severity}] ${i.ruleId} ${where}`)
        }
      })
      if (hasError) process.exit(2)
      return
    }

    case 'publish': {
      const projectId = sub
      if (!projectId) die('Usage: talia publish <projectId>')
      const { client } = await getAuthedClient()
      const { error } = await publishProject(client, projectId)
      if (error) die(String((error as { message?: string }).message ?? error))
      ok(projectId, '✓ Published (snapshot rebuilt)')
      return
    }

    case 'choice': {
      const { client } = await getAuthedClient()
      if (sub === 'add') {
        const nodeId = rest[0]
        if (!nodeId) die('Usage: talia choice add <nodeId> [label] [targetNodeId]')
        const label = rest[1]
        const target = rest[2]
        const { count } = await client.from('choices').select('id', { count: 'exact', head: true }).eq('node_id', nodeId)
        const c = await insertChoice(client, nodeId, count ?? 0)
        if (label !== undefined || target !== undefined) {
          await updateChoiceRow(client, c.id, { ...(label !== undefined ? { label } : {}), ...(target ? { target_node_id: target } : {}) })
        }
        ok(c.id, `✓ Added choice ${c.id}`)
        return
      }
      if (sub === 'set') {
        const [choiceId, field, ...valueParts] = rest
        const value = valueParts.join(' ')
        if (!choiceId || !field) die('Usage: talia choice set <choiceId> <label|target> <value>')
        if (field === 'label') await updateChoiceRow(client, choiceId, { label: value })
        else if (field === 'target') await updateChoiceRow(client, choiceId, { target_node_id: value || null })
        else die('field must be "label" or "target"')
        ok(choiceId, '✓ Updated')
        return
      }
      if (sub === 'rm') {
        if (!rest[0]) die('Usage: talia choice rm <choiceId>')
        await deleteChoiceRow(client, rest[0])
        ok(rest[0], '✓ Removed')
        return
      }
      if (sub === 'present') {
        const [choiceId, ...jsonParts] = rest
        const json = jsonParts.join(' ')
        if (!choiceId || !json) die('Usage: talia choice present <choiceId> \'{"skin":"preset:gilded","size":"l"}\'')
        // Invariant-safe: normalize (clamp/whitelist) then writePresentation, which
        // only touches the `presentation` sibling key — never emits mode/template.
        const pres = normalizePresentation(JSON.parse(json))
        const { data } = await client.from('choices').select('interaction').eq('id', choiceId).single()
        const nextItx = writePresentation(data?.interaction, pres)
        await updateChoiceRow(client, choiceId, { interaction: nextItx as Choice['interaction'] })
        ok(choiceId, '✓ Presentation set')
        return
      }
      if (sub === 'tap') {
        const [choiceId, x, y, w, h, ...hintParts] = rest
        if (!choiceId || x === undefined || y === undefined || w === undefined || h === undefined) {
          die('Usage: talia choice tap <choiceId> <x> <y> <w> <h> [hint]  (normalized 0..1)')
        }
        const hint = hintParts.join(' ')
        const tap_region = { x: Number(x), y: Number(y), w: Number(w), h: Number(h), ...(hint ? { hint } : {}) }
        await updateChoiceRow(client, choiceId, { choice_type: 'tap_region', tap_region: tap_region as Choice['tap_region'] })
        ok(choiceId, '✓ Tap region set (choice_type → tap_region)')
        return
      }
      if (sub === 'interaction') {
        const [choiceId, ...jsonParts] = rest
        const json = jsonParts.join(' ')
        if (!choiceId || !json) die('Usage: talia choice interaction <choiceId> \'{"template":"hotspot_collect","hitGoto":"<nodeId>","defaultGoto":"<nodeId>","params":{"needK":3}}\'')
        const spec = JSON.parse(json) as {
          template?: string; anchorMode?: AnchorMode; timepoint?: number; timedStart?: number; timedEnd?: number
          once?: boolean; hitGoto?: string | null; missGoto?: string | null; defaultGoto?: string | null
          params?: Record<string, unknown>; media?: { rate?: number; loopStart?: number; loopEnd?: number }
        }
        if (!spec.template) die('interaction json needs a "template" (e.g. hotspot_collect, bullet_time, combo_rated, wipe_reveal, roaming_reticle, timing_meter)')
        // Serialize through core: enforces §2.1.1 (target ≡ default.goto), seeds sane
        // params (hotspot regions etc.), and mirrors basic gestures into tap_region.
        const model = {
          template: spec.template,
          anchorMode: spec.anchorMode ?? 'end',
          timepoint: spec.timepoint ?? 0,
          timedStart: spec.timedStart ?? 0,
          timedEnd: spec.timedEnd ?? 0,
          once: spec.once ?? false,
          hitGoto: spec.hitGoto ?? null,
          missGoto: spec.missGoto ?? null,
          defaultGoto: spec.defaultGoto ?? null,
          params: { ...defaultParamsFor(spec.template), ...(spec.params ?? {}) },
          media: spec.media ?? {},
        }
        const s = serializeInteraction(model)
        const patch: Partial<Choice> = {
          choice_type: 'tap_region',
          interaction: s.interaction as unknown as Choice['interaction'],
          target_node_id: s.targetNodeId,
        }
        if (s.tapRegionGesture) {
          const { data } = await client.from('choices').select('tap_region').eq('id', choiceId).single()
          patch.tap_region = { ...((data?.tap_region as object) ?? {}), ...s.tapRegionGesture } as Choice['tap_region']
        }
        await updateChoiceRow(client, choiceId, patch)
        ok(choiceId, `✓ Interaction set (template=${spec.template})`, { template: spec.template })
        return
      }
      die('Unknown choice subcommand. Try: add | set | rm | present | tap | interaction')
      return
    }

    case 'choices': {
      const nodeId = sub
      if (!nodeId) die('Usage: talia choices <nodeId>')
      const { client } = await getAuthedClient()
      const { data } = await client.from('choices').select('*').eq('node_id', nodeId).order('sort_order', { ascending: true })
      const choices = (data ?? []) as Choice[]
      emit(choices, () => {
        for (const c of choices) console.log(`${c.id}  "${c.label}" -> ${c.target_node_id ? c.target_node_id.slice(0, 8) : '(none)'}  [${c.choice_type}]`)
        if (!choices.length) console.log('(no choices)')
      })
      return
    }

    case 'var': {
      const { client } = await getAuthedClient()
      if (sub === 'add') {
        const [projectId, name, type, def] = rest
        if (!projectId || !name || (type !== 'bool' && type !== 'int')) die('Usage: talia var add <projectId> <name> <bool|int> [default]')
        const defaultValue = def === undefined ? undefined : (type === 'bool' ? def === 'true' : Number(def))
        const v = await insertVariable(client, { projectId, name, varType: type as VarType, defaultValue })
        ok(v.id, `✓ Added variable ${v.id}  ${v.name} (${v.var_type})`, { name: v.name, varType: v.var_type })
        return
      }
      if (sub === 'rm') {
        if (!rest[0]) die('Usage: talia var rm <varId>')
        await deleteVariableRow(client, rest[0])
        ok(rest[0], '✓ Removed')
        return
      }
      die('Unknown var subcommand. Try: add | rm')
      return
    }

    case 'vars': {
      const projectId = sub
      if (!projectId) die('Usage: talia vars <projectId>')
      const { client } = await getAuthedClient()
      const { data } = await client.from('variables').select('*').eq('project_id', projectId).order('created_at', { ascending: true })
      const variables = (data ?? []) as Variable[]
      emit(variables, () => {
        for (const v of variables) console.log(`${v.id}  ${v.name}  ${v.var_type}  default=${v.default_value}`)
        if (!variables.length) console.log('(no variables)')
      })
      return
    }

    case 'ach': {
      const { client } = await getAuthedClient()
      if (sub === 'add') {
        const [projectId, name, emoji, ...descParts] = rest
        if (!projectId || !name || !emoji) die('Usage: talia ach add <projectId> <name> <emoji> [description]')
        const description = descParts.length ? descParts.join(' ') : null
        // Condition is left null here (manual grant via choice.grants_achievement_id,
        // or set later in the editor); the op accepts a null ConditionExpr.
        const a = await insertAchievement(client, { projectId, name, emoji, description, conditionExpr: null })
        ok(a.id, `✓ Added achievement ${a.id}  ${a.emoji} ${a.name}`, { name: a.name })
        return
      }
      if (sub === 'rm') {
        if (!rest[0]) die('Usage: talia ach rm <achId>')
        await deleteAchievementRow(client, rest[0])
        ok(rest[0], '✓ Removed')
        return
      }
      die('Unknown ach subcommand. Try: add | rm')
      return
    }

    case 'achs': {
      const projectId = sub
      if (!projectId) die('Usage: talia achs <projectId>')
      const { client } = await getAuthedClient()
      const { data } = await client.from('achievements').select('*').eq('project_id', projectId).order('created_at', { ascending: true })
      const achievements = (data ?? []) as Achievement[]
      emit(achievements, () => {
        for (const a of achievements) console.log(`${a.id}  ${a.emoji} ${a.name}`)
        if (!achievements.length) console.log('(no achievements)')
      })
      return
    }

    case 'import-outline': {
      const projectId = sub
      const file = rest[0]
      if (!projectId || !file) die('Usage: talia import-outline <projectId> <file.md>')
      const { client } = await getAuthedClient()
      await importOutline(client, projectId, file)
      return
    }

    case 'asset': {
      const { client, user } = await getAuthedClient()
      if (sub === 'upload') {
        const [projectId, file] = rest
        if (!projectId || !file) die('Usage: talia asset upload <projectId> <file>')
        const bytes = new Uint8Array(readFileSync(file))
        const fileName = basename(file)
        const mimeType = mimeFor(fileName)
        const kind = inferKindFromName(fileName, mimeType)
        const res = await uploadAsset(client, nodeTransport, {
          body: bytes, sizeBytes: bytes.byteLength, fileName, kind, mimeType, ownerId: user.id, projectId, pathPrefix: `cli/${projectId}`,
        })
        ok(res.asset?.id ?? null, `✓ Uploaded ${res.url}${res.asset ? `  (asset ${res.asset.id})` : '  (not registered)'}`, { url: res.url })
        return
      }
      if (sub === 'rm') {
        if (!rest[0]) die('Usage: talia asset rm <assetId>')
        await deleteAssetRow(client, rest[0])
        ok(rest[0], '✓ Removed')
        return
      }
      die('Unknown asset subcommand. Try: upload | rm')
      return
    }

    case 'assets': {
      const projectId = sub
      if (!projectId) die('Usage: talia assets <projectId>')
      const { client } = await getAuthedClient()
      const { data } = await client.from('assets').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
      const assets = (data ?? []) as { id: string; kind: string; r2_url: string; original_filename: string | null }[]
      emit(assets, () => {
        for (const a of assets) console.log(`${a.id}  [${a.kind}]  ${a.original_filename ?? ''}  ${a.r2_url}`)
        if (!assets.length) console.log('(no assets)')
      })
      return
    }

    default:
      die(`Unknown command "${cmd}". Run: talia help`)
  }
}

// deno-lint / eslint: any is fine for the loose supabase client here
async function loadProject(
  client: Awaited<ReturnType<typeof getAuthedClient>>['client'],
  projectId: string,
): Promise<[Project, StoryNode[], Choice[], Variable[], Achievement[]]> {
  const proj = (await client.from('projects').select('*').eq('id', projectId).single()).data as Project
  if (!proj) die('Project not found (or not yours)')
  const nodes = ((await client.from('nodes').select('*').eq('project_id', projectId).neq('status', 'removed')).data ?? []) as StoryNode[]
  const nodeIds = nodes.map(n => n.id)
  const choices = nodeIds.length
    ? (((await client.from('choices').select('*').in('node_id', nodeIds)).data ?? []) as Choice[])
    : []
  const variables = ((await client.from('variables').select('*').eq('project_id', projectId)).data ?? []) as Variable[]
  const achievements = ((await client.from('achievements').select('*').eq('project_id', projectId)).data ?? []) as Achievement[]
  return [proj, nodes, choices, variables, achievements]
}

// ── import-outline ───────────────────────────────────────────────────────────────
interface OutlineNode { title: string; choices: { label: string; target: string }[] }

export function parseOutline(text: string): OutlineNode[] {
  const nodes: OutlineNode[] = []
  let current: OutlineNode | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (heading) { current = { title: heading[1], choices: [] }; nodes.push(current); continue }
    const choice = line.match(/^-\s*(.+?)\s*->\s*(.+?)\s*$/)
    if (choice && current) current.choices.push({ label: choice[1], target: choice[2] })
  }
  return nodes
}

async function importOutline(client: SupabaseClient, projectId: string, file: string): Promise<void> {
  const outline = parseOutline(readFileSync(file, 'utf8'))
  if (!outline.length) die('No nodes found — expected "# Title" headings.')

  // Pass 1: create nodes, map title → id.
  const idByTitle = new Map<string, string>()
  let firstId: string | null = null
  for (let i = 0; i < outline.length; i++) {
    const { dbFields, node } = buildNewNode({ projectId, x: 0, y: i * 220, title: outline[i].title })
    const { error } = await insertNode(client, dbFields)
    if (error) die(`node "${outline[i].title}": ${String((error as { message?: string }).message ?? error)}`)
    idByTitle.set(outline[i].title, node.id)
    if (i === 0) firstId = node.id
  }

  // Pass 2: wire choices by target title.
  let choiceCount = 0
  const unresolved: string[] = []
  for (const n of outline) {
    const nodeId = idByTitle.get(n.title)!
    let sort = 0
    for (const ch of n.choices) {
      const target = idByTitle.get(ch.target) ?? null
      if (!target) unresolved.push(`${n.title} -> ${ch.target}`)
      const c = await insertChoice(client, nodeId, sort++)
      await updateChoiceRow(client, c.id, { label: ch.label, target_node_id: target })
      choiceCount++
    }
  }

  // First node becomes the project Start.
  if (firstId) await updateProjectRow(client, projectId, { start_node_id: firstId })

  console.log(`✓ Imported ${outline.length} nodes, ${choiceCount} choices${firstId ? `, Start = "${outline[0].title}"` : ''}`)
  if (unresolved.length) {
    console.log(`⚠ ${unresolved.length} choice(s) point to unknown nodes (target left unset):`)
    for (const u of unresolved) console.log(`  ${u}`)
  }
}

main().catch(err => die(errMsg(err)))
