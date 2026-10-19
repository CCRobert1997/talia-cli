#!/usr/bin/env node

// packages/cli/src/index.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { basename as basename2 } from "node:path";

// packages/cli/src/client.ts
import { createClient } from "@supabase/supabase-js";

// packages/cli/src/config.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
var DIR = join(homedir(), ".talia");
var CONFIG = join(DIR, "config.json");
var CREDS = join(DIR, "credentials.json");
var DEFAULT_URL = "https://jbknghsqbbgjqjwlhlke.supabase.co";
var DEFAULT_ANON_KEY = "sb_publishable_f52xWqgGf1osCCu8f-hl8g_ulHO7lyK";
function readJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}
function writeJson(path, data) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}
function getSupabaseConfig() {
  const fromFile = readJson(CONFIG) ?? {};
  const url = process.env.SUPABASE_URL ?? fromFile.url ?? DEFAULT_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? fromFile.anonKey ?? DEFAULT_ANON_KEY;
  return { url, anonKey };
}
var saveSession = (s) => writeJson(CREDS, s);
var loadSession = () => readJson(CREDS);
var clearSession = () => {
  if (existsSync(CREDS)) writeFileSync(CREDS, "{}");
};

// packages/cli/src/client.ts
function bareClient() {
  const { url, anonKey } = getSupabaseConfig();
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function login(email, password) {
  const client = bareClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error("No session returned");
  saveSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    email: data.user?.email ?? email
  });
  return data.user;
}
async function getAuthedClient() {
  const session = loadSession();
  if (!session?.access_token) throw new Error("Not logged in. Run: talia login");
  const client = bareClient();
  const { data, error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  });
  if (error) throw new Error(`Session expired \u2014 run: talia login (${error.message})`);
  if (!data.user) throw new Error("Not logged in. Run: talia login");
  return { client, user: data.user };
}

// packages/cli/src/transport.ts
import { basename } from "node:path";
var UPLOAD_WORKER = process.env.UPLOAD_WORKER_URL ?? "https://upload.taliaapp.com";
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
var nodeTransport = {
  async presign({ fileType, fileName, contentType, pathPrefix }) {
    const r = await fetch(`${UPLOAD_WORKER}/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ fileType, fileName, nodeId: pathPrefix, contentType })
    });
    if (!r.ok) throw new Error(`presign failed: ${r.status}`);
    return r.json();
  },
  async putBytes(uploadUrl, bytes, contentType) {
    const r = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType, "User-Agent": UA }, body: bytes });
    if (!r.ok) throw new Error(`upload PUT failed: ${r.status}`);
  }
};
var MIME = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg"
};
function mimeFor(fileName) {
  const ext = basename(fileName).toLowerCase().split(".").pop() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

// packages/authoring-core/src/ops/assets.ts
function inferBucket(kind) {
  return kind === "video" ? "player-videos" : "player-images";
}
function parseR2Key(publicUrl) {
  try {
    return new URL(publicUrl).pathname.replace(/^\//, "");
  } catch {
    return publicUrl;
  }
}
function inferKindFromName(name, mime) {
  const lower = name.toLowerCase().split("?")[0];
  if (/\.(mp4|mov|webm|m4v|mkv)$/.test(lower) || mime?.startsWith("video/")) return "video";
  if (/\.(jpg|jpeg|png|webp|gif|avif)$/.test(lower) || mime?.startsWith("image/")) return "image";
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(lower) || mime?.startsWith("audio/")) return "audio";
  return "other";
}
var NO_META = { width: null, height: null, durationMs: null };
async function registerAsset(client, row) {
  const { data, error } = await client.from("assets").insert(row).select().single();
  if (error) throw error;
  return data;
}
async function deleteAssetRow(client, id) {
  const { error } = await client.from("assets").delete().eq("id", id);
  if (error) throw error;
}
async function uploadAsset(client, transport, input) {
  const fileType = input.kind === "video" ? "video" : "image";
  const { uploadUrl, publicUrl } = await transport.presign({
    fileType,
    fileName: input.fileName,
    contentType: input.mimeType,
    pathPrefix: input.pathPrefix
  });
  const meta = transport.extractMeta ? await transport.extractMeta() : NO_META;
  await transport.putBytes(uploadUrl, input.body, input.mimeType);
  const key = parseR2Key(publicUrl);
  const bucket = inferBucket(input.kind);
  let asset = null;
  try {
    asset = await registerAsset(client, {
      owner_id: input.ownerId,
      project_id: input.projectId ?? null,
      kind: input.kind,
      bucket,
      r2_key: key,
      r2_url: publicUrl,
      original_filename: input.fileName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      width: meta.width,
      height: meta.height,
      duration_ms: meta.durationMs
    });
  } catch (err) {
    console.error("[uploadAsset] registry insert failed:", err);
  }
  return { url: publicUrl, key, bucket, asset };
}

// packages/authoring-core/src/ops/projects.ts
async function insertProject(client, ownerId, title) {
  const { data, error } = await client.from("projects").insert({ owner_id: ownerId, title, status: "draft" }).select().single();
  if (error) throw error;
  return data;
}
async function updateProjectRow(client, id, patch) {
  const { error } = await client.from("projects").update({ ...patch, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id);
  if (error) throw error;
}
async function deleteProjectCascade(client, id) {
  const { data: nodeRows, error: nodeSelErr } = await client.from("nodes").select("id").eq("project_id", id);
  if (nodeSelErr) throw nodeSelErr;
  const nodeIds = (nodeRows ?? []).map((n) => n.id);
  if (nodeIds.length > 0) {
    const { error: chErr } = await client.from("choices").delete().in("node_id", nodeIds);
    if (chErr) throw chErr;
    const { error: nmErr } = await client.from("node_meta").delete().in("node_id", nodeIds);
    if (nmErr) throw nmErr;
  }
  const { error: nErr } = await client.from("nodes").delete().eq("project_id", id);
  if (nErr) throw nErr;
  const { error: vErr } = await client.from("variables").delete().eq("project_id", id);
  if (vErr) throw vErr;
  const { error: csErr } = await client.from("collab_submissions").delete().eq("project_id", id);
  if (csErr) throw csErr;
  const { error } = await client.from("projects").delete().eq("id", id);
  if (error) throw error;
}

// packages/authoring-core/src/ops/nodes.ts
function buildNewNode(input) {
  const id = crypto.randomUUID();
  const dbFields = {
    id,
    project_id: input.projectId,
    title: input.title,
    status: "draft",
    node_type: "normal",
    media_type: "video",
    trigger_mode: "end",
    image_urls: [],
    canvas_x: Math.round(input.x),
    canvas_y: Math.round(input.y)
  };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const node = {
    ...dbFields,
    video_url: null,
    thumbnail_url: null,
    contributor_id: null,
    auto_advance: false,
    ai_replace_enabled: false,
    ai_replace_segments: null,
    share_as_short: false,
    created_at: now,
    updated_at: now,
    meta: { node_id: id, tags: [], achievement_name: null, prerequisite_node_ids: [] }
  };
  return { dbFields, node };
}
async function insertNode(client, dbFields) {
  const { error } = await client.from("nodes").insert(dbFields);
  if (error) return { error };
  void client.from("node_meta").insert({
    node_id: dbFields.id,
    tags: [],
    achievement_name: null,
    prerequisite_node_ids: []
  });
  return { error: null };
}
async function updateNodeRow(client, id, dbUpdates, meta) {
  if (Object.keys(dbUpdates).length > 0) {
    const { error } = await client.from("nodes").update({ ...dbUpdates, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id);
    if (error) throw error;
  }
  if (meta) {
    await client.from("node_meta").upsert({ ...meta, node_id: id });
  }
}

// packages/authoring-core/src/ops/choices.ts
async function insertChoice(client, nodeId, sortOrder) {
  const { data, error } = await client.from("choices").insert({
    node_id: nodeId,
    label: "",
    target_node_id: null,
    display_mode: "hide",
    condition_expr: null,
    sort_order: sortOrder
  }).select().single();
  if (error) throw error;
  return data;
}
async function updateChoiceRow(client, id, updates) {
  const { error } = await client.from("choices").update(updates).eq("id", id);
  if (error) throw error;
}
async function deleteChoiceRow(client, id) {
  const { error } = await client.from("choices").delete().eq("id", id);
  if (error) throw error;
}

// packages/authoring-core/src/invariants/choicePresentation.ts
var SKIN_PRESET_IDS = ["outline", "gilded", "film", "romance"];
var PRESENTATION_FONTS = [
  { id: "default", stack: "inherit", script: "all" },
  // Latin (+ Cyrillic where noted) display faces
  { id: "modak", stack: "'Modak', system-ui, sans-serif", script: "latin" },
  { id: "playfair", stack: "'Playfair Display', Georgia, serif", script: "latin" },
  { id: "bebas", stack: "'Bebas Neue', Impact, sans-serif", script: "latin" },
  { id: "oswald", stack: "'Oswald', 'Arial Narrow', sans-serif", script: "latin" },
  { id: "pacifico", stack: "'Pacifico', cursive", script: "latin" },
  { id: "anton", stack: "'Anton', Impact, sans-serif", script: "latin" },
  // CJK faces
  { id: "noto_sans_sc", stack: "'Noto Sans SC', sans-serif", script: "cjk" },
  { id: "noto_serif_sc", stack: "'Noto Serif SC', serif", script: "cjk" },
  { id: "ma_shan_zheng", stack: "'Ma Shan Zheng', cursive", script: "cjk" },
  { id: "long_cang", stack: "'Long Cang', cursive", script: "cjk" },
  // Arabic (+ Latin)
  { id: "cairo", stack: "'Cairo', system-ui, sans-serif", script: "arabic" }
];
var PRESENTATION_FONT_IDS = PRESENTATION_FONTS.map((f) => f.id);
var PRESENTATION_SIZES = ["s", "m", "l"];
var KEY = "presentation";
var NARRATION_MAX = 280;
var clamp01 = (n) => Math.min(1, Math.max(0, n));
var clampRange = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
var num = (v, fb) => typeof v === "number" && Number.isFinite(v) ? v : fb;
var round3 = (n) => +n.toFixed(3);
function isValidSkin(skin) {
  if (typeof skin !== "string") return false;
  if (skin === "default") return true;
  if (skin.startsWith("preset:")) return SKIN_PRESET_IDS.includes(skin.slice(7));
  if (skin.startsWith("image:")) return /^https?:\/\/\S+/i.test(skin.slice(6));
  return false;
}
var isImageSkin = (skin) => !!skin && skin.startsWith("image:");
function normalizePresentation(p) {
  const o = p && typeof p === "object" ? p : {};
  const anchor = o.anchor === "frame" ? "frame" : "bar";
  const size = PRESENTATION_SIZES.includes(o.size) ? o.size : "m";
  const skin = isValidSkin(o.skin) ? o.skin : "default";
  const out = { anchor, skin, size };
  if (anchor === "frame") {
    const pos = o.pos;
    out.pos = { x: round3(clamp01(num(pos?.x, 0.5))), y: round3(clamp01(num(pos?.y, 0.5))) };
    if (o.w != null) out.w = round3(clampRange(num(o.w, 0.4), 0.1, 1));
  }
  if (typeof o.font === "string" && PRESENTATION_FONT_IDS.includes(o.font) && o.font !== "default") {
    out.font = o.font;
  }
  if (typeof o.narration === "string" && o.narration.trim()) {
    out.narration = o.narration.trim().slice(0, NARRATION_MAX);
  }
  return out;
}
function isTrivialPresentation(p) {
  return p.anchor === "bar" && p.skin === "default" && p.size === "m" && !p.font && !p.narration;
}
function parsePresentation(interaction) {
  if (!interaction || typeof interaction !== "object") return null;
  const p = interaction[KEY];
  if (!p || typeof p !== "object") return null;
  return normalizePresentation(p);
}
function writePresentation(interaction, p) {
  const base = interaction && typeof interaction === "object" ? { ...interaction } : {};
  if (!p || isTrivialPresentation(p)) delete base[KEY];
  else base[KEY] = normalizePresentation(p);
  return Object.keys(base).length === 0 ? null : base;
}

// packages/authoring-core/src/invariants/interactionTemplates.ts
var INTERACTION_TEMPLATES = [
  {
    id: "tap",
    group: "basic",
    tags: ["common"],
    outcomes: ["default"],
    params: [
      { key: "region", type: "region" },
      { key: "target", type: "goto" },
      { key: "style", type: "style", advanced: true }
    ]
  },
  {
    id: "swipe",
    group: "basic",
    tags: ["common", "combat"],
    outcomes: ["default"],
    params: [
      { key: "region", type: "region" },
      { key: "target", type: "goto" },
      { key: "direction", type: "style", advanced: true },
      { key: "style", type: "style", advanced: true }
    ]
  },
  {
    id: "rapid_tap",
    group: "basic",
    tags: ["combat"],
    outcomes: ["default"],
    params: [
      { key: "region", type: "region" },
      { key: "target", type: "goto" },
      { key: "count", type: "int", advanced: true },
      { key: "style", type: "style", advanced: true }
    ]
  },
  {
    id: "hold",
    group: "basic",
    tags: ["common"],
    outcomes: ["default"],
    params: [
      { key: "region", type: "region" },
      { key: "target", type: "goto" },
      { key: "duration", type: "seconds", advanced: true },
      { key: "style", type: "style", advanced: true }
    ]
  },
  {
    id: "bullet_time",
    group: "advanced",
    tags: ["combat", "dodge"],
    outcomes: ["hit", "miss", "default"],
    params: [
      { key: "region", type: "region" },
      { key: "hit", type: "goto" },
      { key: "miss", type: "goto" },
      { key: "rate", type: "float", advanced: true },
      { key: "window", type: "seconds", advanced: true },
      { key: "style", type: "style", advanced: true }
    ]
  },
  {
    id: "combo_rated",
    group: "advanced",
    tags: ["combat", "rhythm"],
    outcomes: ["hit", "miss", "default"],
    params: [
      { key: "count", type: "int" },
      { key: "window", type: "seconds" },
      { key: "hit", type: "goto" },
      { key: "miss", type: "goto" },
      { key: "perfect", type: "int", advanced: true },
      { key: "ratingVar", type: "var", advanced: true }
    ]
  },
  {
    id: "hotspot_collect",
    group: "advanced",
    tags: ["search", "puzzle"],
    outcomes: ["hit", "default"],
    params: [
      { key: "regions", type: "regions" },
      { key: "needK", type: "int" },
      { key: "hit", type: "goto" },
      { key: "findVars", type: "var", advanced: true },
      { key: "window", type: "seconds", advanced: true }
    ]
  },
  {
    id: "wipe_reveal",
    group: "advanced",
    tags: ["search", "mystery"],
    outcomes: ["hit", "default"],
    params: [
      { key: "mask", type: "mask" },
      { key: "threshold", type: "int" },
      { key: "hit", type: "goto" },
      { key: "brush", type: "int", advanced: true }
    ]
  },
  // Roaming reticle (A1): a light point random-walks inside the region (walk range),
  // tap to stop; stopping inside the centered target zone = hit (shooting crosshair).
  {
    id: "roaming_reticle",
    group: "advanced",
    tags: ["combat", "skill"],
    outcomes: ["hit", "miss", "default"],
    params: [
      { key: "region", type: "region" },
      { key: "hit", type: "goto" },
      { key: "miss", type: "goto" },
      { key: "targetSize", type: "float", advanced: true },
      { key: "speed", type: "float", advanced: true },
      { key: "window", type: "seconds", advanced: true }
    ]
  },
  // Timing meter (B2): a symmetric gradient bar (green center / yellow / red) drawn
  // in the region; a marker sweeps back and forth; tap on green/yellow = hit, red =
  // miss; the grade (perfect/good/miss) is written to ratingVar.
  {
    id: "timing_meter",
    group: "advanced",
    tags: ["rhythm", "skill"],
    outcomes: ["hit", "miss", "default"],
    params: [
      { key: "region", type: "region" },
      { key: "orientation", type: "orientation" },
      { key: "hit", type: "goto" },
      { key: "miss", type: "goto" },
      { key: "greenFrac", type: "float", advanced: true },
      { key: "yellowFrac", type: "float", advanced: true },
      { key: "speed", type: "float", advanced: true },
      { key: "window", type: "seconds", advanced: true },
      { key: "ratingVar", type: "var", advanced: true }
    ]
  }
];
function defaultHotspotRegions(needK) {
  const k = Math.max(1, Math.min(8, needK));
  const size = 0.14;
  const cols = Math.min(k, 3);
  const rows = Math.ceil(k / cols);
  const out = [];
  for (let i = 0; i < k; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = (col + 1) / (cols + 1);
    const cy = rows === 1 ? 0.45 : (row + 1) / (rows + 1);
    out.push({ x: +(cx - size / 2).toFixed(3), y: +(cy - size / 2).toFixed(3), w: size, h: size });
  }
  return out;
}
var TEMPLATE_DEFAULT_PARAMS = {
  bullet_time: { window: 3 },
  combo_rated: { count: 8, window: 3, perfect: 12 },
  hotspot_collect: { needK: 3 },
  wipe_reveal: { threshold: 60, brush: 40, mask: "@current_frame" },
  roaming_reticle: { targetSize: 0.3, speed: 1, window: 3 },
  timing_meter: { orientation: "horizontal", greenFrac: 0.2, yellowFrac: 0.15, speed: 1, window: 4 }
};
var defaultParamsFor = (id) => {
  const base = { ...TEMPLATE_DEFAULT_PARAMS[id] ?? {} };
  if (id === "hotspot_collect") {
    const needK = typeof base.needK === "number" ? base.needK : 3;
    base.regions = defaultHotspotRegions(needK);
  }
  return base;
};
var getTemplate = (id) => INTERACTION_TEMPLATES.find((t) => t.id === id);

// packages/authoring-core/src/invariants/interactionSchema.ts
var RUNTIME_VERSION = 1;
var gotoOrResume = (id) => id ? { goto: id } : "resume";
function isEndlessInteraction(model) {
  if (model.template !== "hotspot_collect") return false;
  const w = model.params.window;
  return !(typeof w === "number" && w > 0);
}
function serializeInteraction(model) {
  const tpl = getTemplate(model.template);
  const slots = tpl?.outcomes ?? ["default"];
  const endless = isEndlessInteraction(model);
  const outcomes = {
    default: gotoOrResume(endless ? model.hitGoto : model.defaultGoto)
  };
  if (slots.includes("hit")) outcomes.hit = gotoOrResume(model.hitGoto);
  if (slots.includes("miss") && !endless) outcomes.miss = gotoOrResume(model.missGoto);
  const anchor = { mode: model.anchorMode };
  if (model.anchorMode === "timepoint") anchor.t = model.timepoint;
  if (model.anchorMode === "timed_window") {
    anchor.start_s = model.timedStart;
    anchor.end_s = model.timedEnd;
  }
  if (model.once) anchor.once = true;
  const media = {};
  if (typeof model.media.rate === "number") media.rate = model.media.rate;
  if (typeof model.media.loopStart === "number" && typeof model.media.loopEnd === "number") {
    media.loop = [model.media.loopStart, model.media.loopEnd];
  }
  const interaction = {
    v: 1,
    min_runtime: RUNTIME_VERSION,
    template: model.template,
    anchor,
    outcomes,
    ...Object.keys(media).length ? { media } : {},
    ...Object.keys(model.params).length ? { params: model.params } : {}
  };
  const basicModes = ["tap", "swipe", "rapid_tap", "hold"];
  let tapRegionGesture = null;
  if (basicModes.includes(model.template)) {
    const p = model.params;
    const g = { mode: model.template };
    if (typeof p.style === "string" && p.style) g.style = p.style;
    if (model.template === "swipe") {
      const d = p.direction;
      g.swipe = { direction: d === "down" || d === "left" || d === "right" ? d : "up" };
    } else if (model.template === "rapid_tap") {
      g.rapid_tap = { count: typeof p.count === "number" ? p.count : 5 };
    } else if (model.template === "hold") {
      g.hold = { duration_ms: (typeof p.duration === "number" ? p.duration : 1.5) * 1e3 };
    }
    tapRegionGesture = g;
  }
  return {
    interaction,
    tapRegionGesture,
    // §2.1.1: old-app routing must match new-app degradation.
    targetNodeId: endless ? model.hitGoto : model.defaultGoto
  };
}

// packages/authoring-core/src/ops/variables.ts
async function insertVariable(client, input) {
  const { data, error } = await client.from("variables").insert({
    project_id: input.projectId,
    name: input.name,
    var_type: input.varType,
    default_value: input.defaultValue !== void 0 ? input.defaultValue : input.varType === "bool" ? false : 0,
    min_value: input.minValue ?? null,
    max_value: input.maxValue ?? null
  }).select().single();
  if (error) throw error;
  return data;
}
async function deleteVariableRow(client, id) {
  const { error } = await client.from("variables").delete().eq("id", id);
  if (error) throw error;
}

// packages/authoring-core/src/ops/achievements.ts
async function insertAchievement(client, input) {
  const { data, error } = await client.from("achievements").insert({
    project_id: input.projectId,
    name: input.name,
    emoji: input.emoji,
    description: input.description,
    condition_expr: input.conditionExpr
  }).select().single();
  if (error) throw error;
  return data;
}
async function deleteAchievementRow(client, id) {
  const { error } = await client.from("achievements").delete().eq("id", id);
  if (error) throw error;
}

// packages/authoring-core/src/ops/publish.ts
var FULLSCREEN_REGION = { x: 0, y: 0, w: 1, h: 1 };
function needsFullscreenFallback(interaction, tapRegion) {
  const hasTemplate = !!(interaction && typeof interaction === "object" && typeof interaction.template === "string");
  const r = tapRegion;
  const hasRegion = !!(r && typeof r.w === "number" && typeof r.h === "number" && r.w > 0 && r.h > 0);
  return hasTemplate && !hasRegion;
}
async function ensureFullscreenFallbackRegions(client, projectId) {
  try {
    const { data: nodes } = await client.from("nodes").select("id").eq("project_id", projectId).neq("status", "removed");
    const nodeIds = (nodes ?? []).map((n) => n.id);
    if (!nodeIds.length) return;
    const { data: choices } = await client.from("choices").select("id, interaction, tap_region").in("node_id", nodeIds).eq("choice_type", "tap_region");
    const needing = (choices ?? []).filter(
      (c) => needsFullscreenFallback(c.interaction, c.tap_region)
    );
    for (const c of needing) {
      const merged = { ...c.tap_region ?? {}, ...FULLSCREEN_REGION };
      await client.from("choices").update({ tap_region: merged }).eq("id", c.id);
    }
  } catch (err) {
    console.error("[fullscreen-fallback] backfill failed:", err);
  }
}
async function publishProject(client, projectId) {
  await ensureFullscreenFallbackRegions(client, projectId);
  const { error } = await client.rpc("publish_project", { p_project_id: projectId });
  return { error };
}

// packages/authoring-core/src/validation/rules/aiReplaceMissingPaidEntry.ts
var aiReplaceMissingPaidEntryRule = {
  id: "ai_replace_missing_paid_entry",
  check(ctx) {
    const issues = [];
    for (const node of ctx.nodes) {
      if (ctx.isCommunityNode(node.id)) continue;
      if (!node.ai_replace_enabled) continue;
      const hasPaidEntry = ctx.choices.some(
        (c) => c.choice_type === "ai_replace" && c.ai_replace_node_id === node.id
      );
      if (!hasPaidEntry) {
        issues.push({
          ruleId: this.id,
          severity: "error",
          message: "validation.aiReplace.missingPaidEntry",
          messageParams: { nodeTitle: node.title?.trim() || null },
          nodeId: node.id
        });
      }
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/aiReplaceSegmentMissingVideo.ts
var aiReplaceSegmentMissingVideoRule = {
  id: "ai_replace_segment_missing_video",
  check(ctx) {
    const issues = [];
    for (const node of ctx.nodes) {
      if (ctx.isCommunityNode(node.id)) continue;
      if (!node.ai_replace_enabled) continue;
      const segments = node.ai_replace_segments ?? [];
      segments.forEach((seg, idx) => {
        if (seg.type === "ai_replace" && !seg.video_url) {
          issues.push({
            ruleId: this.id,
            severity: "error",
            message: "validation.aiReplace.segmentMissingVideo",
            messageParams: {
              nodeTitle: node.title?.trim() || null,
              index: idx + 1
            },
            nodeId: node.id,
            segmentIndex: idx
          });
        }
      });
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/aiReplaceSegmentMissingMask.ts
var aiReplaceSegmentMissingMaskRule = {
  id: "ai_replace_segment_missing_mask",
  check(ctx) {
    const issues = [];
    for (const node of ctx.nodes) {
      if (ctx.isCommunityNode(node.id)) continue;
      if (!node.ai_replace_enabled) continue;
      const segments = node.ai_replace_segments ?? [];
      segments.forEach((seg, idx) => {
        if (seg.type !== "ai_replace") return;
        const positiveCount = seg.mask?.positive?.length ?? 0;
        if (positiveCount < 1) {
          issues.push({
            ruleId: this.id,
            severity: "error",
            message: "validation.aiReplace.segmentMissingMask",
            messageParams: {
              nodeTitle: node.title?.trim() || null,
              index: idx + 1
            },
            nodeId: node.id,
            segmentIndex: idx
          });
        }
      });
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/aiReplaceSegmentMissingCost.ts
var AI_REPLACE_SEGMENT_MIN_COST = 20;
var aiReplaceSegmentMissingCostRule = {
  id: "ai_replace_segment_missing_cost",
  check(ctx) {
    const issues = [];
    for (const node of ctx.nodes) {
      if (ctx.isCommunityNode(node.id)) continue;
      if (!node.ai_replace_enabled) continue;
      const segments = node.ai_replace_segments ?? [];
      segments.forEach((seg, idx) => {
        if (seg.type !== "ai_replace") return;
        const cost = seg.tacoin_cost ?? 0;
        if (cost < AI_REPLACE_SEGMENT_MIN_COST) {
          issues.push({
            ruleId: this.id,
            severity: "error",
            message: "validation.aiReplace.segmentMissingCost",
            messageParams: {
              nodeTitle: node.title?.trim() || null,
              index: idx + 1,
              minCost: AI_REPLACE_SEGMENT_MIN_COST
            },
            nodeId: node.id,
            segmentIndex: idx
          });
        }
      });
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/aiReplaceChoiceMissingPaidVar.ts
var aiReplaceChoiceMissingPaidVarRule = {
  id: "ai_replace_choice_missing_paid_var",
  check(ctx) {
    const issues = [];
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue;
      if (choice.choice_type !== "ai_replace") continue;
      if (choice.paid_var_id) continue;
      issues.push({
        ruleId: this.id,
        severity: "error",
        message: "validation.aiReplace.choiceMissingPaidVar",
        messageParams: { choiceLabel: choice.label?.trim() || null },
        nodeId: choice.node_id,
        choiceId: choice.id
      });
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/aiReplacePaidVarNotFound.ts
var aiReplacePaidVarNotFoundRule = {
  id: "ai_replace_paid_var_not_found",
  check(ctx) {
    const issues = [];
    const varIds = new Set(ctx.variables.map((v) => v.id));
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue;
      if (choice.choice_type !== "ai_replace") continue;
      if (!choice.paid_var_id) continue;
      if (varIds.has(choice.paid_var_id)) continue;
      issues.push({
        ruleId: this.id,
        severity: "error",
        message: "validation.aiReplace.paidVarNotFound",
        messageParams: { choiceLabel: choice.label?.trim() || null },
        nodeId: choice.node_id,
        choiceId: choice.id
      });
    }
    return issues;
  }
};

// packages/authoring-core/src/invariants/effectsHelpers.ts
function effectMatchesBool(effect, varId, expected) {
  if (effect.var_id !== varId) return false;
  if (effect.op !== "set") return false;
  const v = effect.value;
  if (typeof v === "boolean") return v === expected;
  if (typeof v === "number") return v !== 0 === expected;
  if (typeof v === "string") return v.toLowerCase() === String(expected);
  return false;
}

// packages/authoring-core/src/validation/rules/aiReplaceChoiceEffectsMissingTrue.ts
var aiReplaceChoiceEffectsMissingTrueRule = {
  id: "ai_replace_choice_effects_missing_true",
  check(ctx) {
    const issues = [];
    const varIds = new Set(ctx.variables.map((v) => v.id));
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue;
      if (choice.choice_type !== "ai_replace") continue;
      if (!choice.paid_var_id) continue;
      if (!varIds.has(choice.paid_var_id)) continue;
      const effects = choice.effects ?? [];
      const hasTrue = effects.some((e) => effectMatchesBool(e, choice.paid_var_id, true));
      if (!hasTrue) {
        issues.push({
          ruleId: this.id,
          severity: "error",
          message: "validation.aiReplace.choiceEffectsMissingTrue",
          messageParams: { choiceLabel: choice.label?.trim() || null },
          nodeId: choice.node_id,
          choiceId: choice.id
        });
      }
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/aiReplaceTargetReachedByNonAiChoice.ts
function extractVarIds(expr) {
  if (!expr) return [];
  if (expr.type === "bool" || expr.type === "int") return [expr.var_id];
  return expr.conditions.map((c) => c.var_id);
}
var aiReplaceTargetReachedByNonAiChoiceRule = {
  id: "ai_replace_target_reached_by_non_ai_choice",
  check(ctx) {
    const issues = [];
    const nodeById = new Map(ctx.nodes.map((n) => [n.id, n]));
    const paidVarsByTarget = /* @__PURE__ */ new Map();
    for (const c of ctx.choices) {
      if (c.choice_type !== "ai_replace") continue;
      if (!c.ai_replace_node_id || !c.paid_var_id) continue;
      let set = paidVarsByTarget.get(c.ai_replace_node_id);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        paidVarsByTarget.set(c.ai_replace_node_id, set);
      }
      set.add(c.paid_var_id);
    }
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue;
      if (!choice.target_node_id) continue;
      if (choice.choice_type === "ai_replace") continue;
      if (ctx.isCommunityNode(choice.target_node_id)) continue;
      const target = nodeById.get(choice.target_node_id);
      if (!target || !target.ai_replace_enabled) continue;
      if (choice.condition_expr) {
        const targetPaidVars = paidVarsByTarget.get(target.id);
        if (targetPaidVars && targetPaidVars.size > 0) {
          const varIds = extractVarIds(choice.condition_expr);
          if (varIds.some((v) => targetPaidVars.has(v))) continue;
        }
      }
      const parent = nodeById.get(choice.node_id);
      issues.push({
        ruleId: this.id,
        severity: "error",
        message: "validation.aiReplace.targetReachedByNonAiChoice",
        messageParams: {
          choiceLabel: choice.label?.trim() || null,
          targetNodeTitle: target.title?.trim() || null,
          parentNodeTitle: parent?.title?.trim() || null
        },
        nodeId: choice.node_id,
        choiceId: choice.id
      });
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/projectMissingStartNode.ts
var projectMissingStartNodeRule = {
  id: "project_missing_start_node",
  check(ctx) {
    const issues = [];
    const startId = ctx.project.start_node_id;
    if (!startId) {
      issues.push({
        ruleId: this.id,
        severity: "error",
        message: "validation.project.missingStartNode"
      });
      return issues;
    }
    const target = ctx.nodes.find((n) => n.id === startId);
    if (!target || target.status === "removed") {
      issues.push({
        ruleId: this.id,
        severity: "error",
        message: "validation.project.startNodeMissing"
      });
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/choiceMissingLabel.ts
var choiceMissingLabelRule = {
  id: "choice_missing_label",
  check(ctx) {
    const issues = [];
    const nodeById = new Map(ctx.nodes.map((n) => [n.id, n]));
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue;
      const label = choice.label?.trim() ?? "";
      if (label.length > 0) continue;
      const parent = nodeById.get(choice.node_id);
      issues.push({
        ruleId: this.id,
        severity: "error",
        message: "validation.choice.missingLabel",
        messageParams: {
          parentNodeTitle: parent?.title?.trim() || null
        },
        nodeId: choice.node_id,
        choiceId: choice.id
      });
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/choiceMissingTarget.ts
var TARGET_REQUIRED_TYPES = /* @__PURE__ */ new Set(["normal", "paid"]);
var choiceMissingTargetRule = {
  id: "choice_missing_target",
  check(ctx) {
    const issues = [];
    const nodeById = new Map(ctx.nodes.map((n) => [n.id, n]));
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue;
      const type = choice.choice_type ?? "normal";
      if (!TARGET_REQUIRED_TYPES.has(type)) continue;
      if (choice.target_node_id) continue;
      const parent = nodeById.get(choice.node_id);
      issues.push({
        ruleId: this.id,
        severity: "error",
        message: "validation.choice.missingTarget",
        messageParams: {
          choiceLabel: choice.label?.trim() || null,
          parentNodeTitle: parent?.title?.trim() || null
        },
        nodeId: choice.node_id,
        choiceId: choice.id
      });
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/choiceInteractionInvalid.ts
var choiceInteractionInvalidRule = {
  id: "choice_interaction_invalid",
  check(ctx) {
    const issues = [];
    const nodeById = new Map(ctx.nodes.map((n) => [n.id, n]));
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue;
      const win = choice.interaction?.window ?? choice.tap_region?.window;
      if (!win || win.type !== "timed") continue;
      const { start_s, end_s } = win;
      if (!(Number.isFinite(start_s) && Number.isFinite(end_s)) || end_s <= start_s) {
        const parent = nodeById.get(choice.node_id);
        issues.push({
          ruleId: this.id,
          severity: "error",
          message: "validation.choice.interactionWindowInvalid",
          messageParams: {
            choiceLabel: choice.label?.trim() || null,
            parentNodeTitle: parent?.title?.trim() || null
          },
          nodeId: choice.node_id,
          choiceId: choice.id
        });
      }
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/hotspotRegionsInsufficient.ts
var hotspotRegionsInsufficientRule = {
  id: "hotspot_regions_insufficient",
  check(ctx) {
    const issues = [];
    const nodeById = new Map(ctx.nodes.map((n) => [n.id, n]));
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue;
      const itx = choice.interaction;
      if (!itx || itx.template !== "hotspot_collect") continue;
      const regions = Array.isArray(itx.params?.regions) ? itx.params.regions : [];
      const needK = typeof itx.params?.needK === "number" ? itx.params.needK : 1;
      const parent = nodeById.get(choice.node_id);
      const base = {
        nodeId: choice.node_id,
        choiceId: choice.id,
        messageParams: {
          choiceLabel: choice.label?.trim() || null,
          parentNodeTitle: parent?.title?.trim() || null,
          needK,
          regionCount: regions.length
        }
      };
      if (regions.length === 0) {
        issues.push({ ...base, ruleId: this.id, severity: "error", message: "validation.hotspot.noRegions" });
      } else if (regions.length < needK) {
        issues.push({ ...base, ruleId: this.id, severity: "warning", message: "validation.hotspot.fewerThanNeedK" });
      }
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/choicePresentationInvalid.ts
var choicePresentationInvalidRule = {
  id: "choice_presentation_invalid",
  check(ctx) {
    const issues = [];
    const nodeById = new Map(ctx.nodes.map((n) => [n.id, n]));
    for (const choice of ctx.choices) {
      if (ctx.isCommunityChoice(choice.id)) continue;
      const pres = parsePresentation(choice.interaction);
      if (!pres) continue;
      if (isImageSkin(pres.skin) && !choice.label?.trim()) {
        const parent = nodeById.get(choice.node_id);
        issues.push({
          ruleId: this.id,
          severity: "error",
          message: "validation.presentation.imageNeedsText",
          messageParams: { parentNodeTitle: parent?.title?.trim() || null },
          nodeId: choice.node_id,
          choiceId: choice.id
        });
      }
    }
    return issues;
  }
};

// packages/authoring-core/src/validation/rules/index.ts
var ALL_RULES = [
  projectMissingStartNodeRule,
  choiceMissingLabelRule,
  choiceMissingTargetRule,
  choiceInteractionInvalidRule,
  hotspotRegionsInsufficientRule,
  choicePresentationInvalidRule,
  aiReplaceMissingPaidEntryRule,
  aiReplaceSegmentMissingVideoRule,
  aiReplaceSegmentMissingMaskRule,
  aiReplaceSegmentMissingCostRule,
  aiReplaceChoiceMissingPaidVarRule,
  aiReplacePaidVarNotFoundRule,
  aiReplaceChoiceEffectsMissingTrueRule,
  aiReplaceTargetReachedByNonAiChoiceRule
];

// packages/authoring-core/src/validation/runner.ts
function buildValidationContext(project, nodes, choices, variables, achievements) {
  const communityNodeIds = new Set(
    nodes.filter((n) => !!n.contributor_id).map((n) => n.id)
  );
  const communityChoiceIds = new Set(
    choices.filter((c) => communityNodeIds.has(c.node_id)).map((c) => c.id)
  );
  const isCommunityNode = (nodeId) => communityNodeIds.has(nodeId);
  const isCommunityChoice = (choiceId) => communityChoiceIds.has(choiceId);
  return {
    project,
    nodes,
    choices,
    variables,
    achievements,
    isCommunityNode,
    isCommunityChoice
  };
}
function runValidation(ctx) {
  return ALL_RULES.flatMap((r) => r.check(ctx));
}

// packages/authoring-core/src/model/index.ts
var THEME_BG_PRESETS = [
  "cream_lavender",
  "dawn_peach",
  "mist_blue",
  "sage_glow",
  "midnight",
  "warm_dark"
];
var isThemeHexColor = (c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
function parseThemeBg(input) {
  if (input == null) return { ok: true, value: null };
  if (typeof input !== "object") return { ok: false, error: "theme must be a preset id, colors, or null" };
  const o = input;
  if (typeof o.preset === "string") {
    if (!THEME_BG_PRESETS.includes(o.preset)) {
      return { ok: false, error: `unknown preset "${o.preset}"; valid: ${THEME_BG_PRESETS.join(", ")}` };
    }
    return { ok: true, value: { preset: o.preset } };
  }
  if (Array.isArray(o.colors)) {
    if (o.colors.length < 2 || o.colors.length > 5) return { ok: false, error: "custom gradient needs 2\u20135 colors" };
    if (!o.colors.every(isThemeHexColor)) return { ok: false, error: "each color must be a #RRGGBB hex" };
    const colors = o.colors;
    return { ok: true, value: typeof o.dark === "boolean" ? { colors, dark: o.dark } : { colors } };
  }
  return { ok: false, error: "theme must be {preset} or {colors, dark?}" };
}

// packages/cli/src/index.ts
var HELP = `talia \u2014 Talia authoring CLI

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
           write commands print {"ok":true,"id":"\u2026"}. For agents. (validate still
           exits 2 when there's an error-severity issue.)

Outline format (import-outline):
  # Node Title
  - Choice label -> Target Node Title
  (first node becomes the project Start; unknown targets are left unset + warned)

Config: SUPABASE_URL / SUPABASE_ANON_KEY (or ~/.talia/config.json). RLS scopes
everything to the logged-in owner.`;
function die(msg) {
  console.error(`\u2717 ${msg}`);
  process.exit(1);
}
function errMsg(e) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e;
    return [o.message, o.details, o.hint, o.code].filter(Boolean).map(String).join(" \xB7 ") || JSON.stringify(e);
  }
  return String(e);
}
async function main() {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes("--json");
  const [cmd, sub, ...rest] = argv.filter((a) => a !== "--json");
  const emit = (data, human) => {
    if (jsonMode) console.log(JSON.stringify(data));
    else human();
  };
  const ok = (id, humanText, extra) => emit({ ok: true, id, ...extra ?? {} }, () => console.log(humanText));
  switch (cmd) {
    case void 0:
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return;
    case "login": {
      const email = sub ?? process.env.TALIA_EMAIL;
      const password = rest[0] ?? process.env.TALIA_PASSWORD;
      if (!email || !password) die("Provide email + password (args) or set TALIA_EMAIL / TALIA_PASSWORD.");
      const user = await login(email, password);
      ok(null, `\u2713 Logged in as ${user.email}`, { email: user.email });
      return;
    }
    case "whoami": {
      const s = loadSession();
      if (!s?.access_token) die("Not logged in. Run: talia login");
      const { user } = await getAuthedClient();
      emit({ id: user.id, email: user.email }, () => console.log(`${user.email} (${user.id})`));
      return;
    }
    case "logout":
      clearSession();
      ok(null, "\u2713 Logged out");
      return;
    case "projects": {
      const { client } = await getAuthedClient();
      const { data, error } = await client.from("projects").select("*").order("updated_at", { ascending: false });
      if (error) die(error.message);
      const projects = data ?? [];
      emit(projects, () => {
        for (const p of projects) console.log(`${p.id}  [${p.status}]  ${p.title}`);
        if (!projects.length) console.log("(no projects)");
      });
      return;
    }
    case "project": {
      if (sub === "new") {
        const title = rest.join(" ").trim();
        if (!title) die("Usage: talia project new <title>");
        const { client, user } = await getAuthedClient();
        const p = await insertProject(client, user.id, title);
        ok(p.id, `\u2713 Created ${p.id}  ${p.title}`, { title: p.title });
        return;
      }
      if (sub === "rm") {
        const projectId = rest[0];
        if (!projectId) die("Usage: talia project rm <projectId>");
        const { client } = await getAuthedClient();
        await deleteProjectCascade(client, projectId);
        ok(projectId, "\u2713 Deleted");
        return;
      }
      if (sub === "theme") {
        const projectId = rest[0];
        const arg = rest[1];
        if (!projectId || !arg) {
          die(`Usage: talia project theme <projectId> <preset|clear|custom>
  preset ids: ${THEME_BG_PRESETS.join(" | ")}
  clear:  talia project theme <id> clear
  custom: talia project theme <id> custom "#RRGGBB,#RRGGBB" [dark]`);
        }
        let candidate;
        if (arg === "clear" || arg === "none") {
          candidate = null;
        } else if (arg === "custom") {
          const colors = (rest[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          const dark = rest[3] === "dark" ? true : rest[3] === "light" ? false : void 0;
          candidate = dark === void 0 ? { colors } : { colors, dark };
        } else {
          candidate = { preset: arg };
        }
        const parsed = parseThemeBg(candidate);
        if (!parsed.ok) die(parsed.error);
        const { client } = await getAuthedClient();
        await updateProjectRow(client, projectId, { theme_bg: parsed.value });
        ok(projectId, parsed.value ? `\u2713 Theme set: ${JSON.stringify(parsed.value)}` : "\u2713 Theme cleared (player default)", { theme: parsed.value });
        return;
      }
      die("Unknown project subcommand. Try: new | rm | theme");
      return;
    }
    case "node": {
      if (sub === "add") {
        const projectId = rest[0];
        if (!projectId) die("Usage: talia node add <projectId>");
        const { client } = await getAuthedClient();
        const { dbFields, node } = buildNewNode({ projectId, x: 0, y: 0, title: "Untitled node" });
        const { error } = await insertNode(client, dbFields);
        if (error) die(String(error.message ?? error));
        ok(node.id, `\u2713 Added node ${node.id}`);
        return;
      }
      if (sub === "set") {
        const [nodeId, field, ...valueParts] = rest;
        const value = valueParts.join(" ");
        if (!nodeId || !field) die("Usage: talia node set <nodeId> <title|video|image|auto> <value>");
        const { client } = await getAuthedClient();
        const patch = field === "title" ? { title: value } : field === "video" ? { video_url: value, media_type: "video" } : field === "image" ? { image_urls: [value], media_type: "images" } : field === "auto" ? { auto_advance: value === "true" } : null;
        if (!patch) die("field must be title | video | image | auto");
        await updateNodeRow(client, nodeId, patch);
        ok(nodeId, "\u2713 Updated");
        return;
      }
      if (sub === "start") {
        const [projectId, nodeId] = rest;
        if (!projectId || !nodeId) die("Usage: talia node start <projectId> <nodeId>");
        const { client } = await getAuthedClient();
        await updateProjectRow(client, projectId, { start_node_id: nodeId });
        ok(nodeId, "\u2713 Start node set", { projectId });
        return;
      }
      die("Unknown node subcommand. Try: add | set | start");
      return;
    }
    case "validate": {
      const projectId = sub;
      if (!projectId) die("Usage: talia validate <projectId>");
      const { client } = await getAuthedClient();
      const [proj, nodes, choices, variables, achievements] = await loadProject(client, projectId);
      const ctx = buildValidationContext(proj, nodes, choices, variables, achievements);
      const issues = runValidation(ctx);
      const hasError = issues.some((i) => i.severity === "error");
      emit({ ok: !hasError, issues }, () => {
        if (!issues.length) {
          console.log("\u2713 No issues \u2014 ready to publish");
          return;
        }
        for (const i of issues) {
          const where = [i.nodeId && `node=${i.nodeId.slice(0, 8)}`, i.choiceId && `choice=${i.choiceId.slice(0, 8)}`].filter(Boolean).join(" ");
          console.log(`[${i.severity}] ${i.ruleId} ${where}`);
        }
      });
      if (hasError) process.exit(2);
      return;
    }
    case "publish": {
      const projectId = sub;
      if (!projectId) die("Usage: talia publish <projectId>");
      const { client } = await getAuthedClient();
      const { error } = await publishProject(client, projectId);
      if (error) die(String(error.message ?? error));
      ok(projectId, "\u2713 Published (snapshot rebuilt)");
      return;
    }
    case "choice": {
      const { client } = await getAuthedClient();
      if (sub === "add") {
        const nodeId = rest[0];
        if (!nodeId) die("Usage: talia choice add <nodeId> [label] [targetNodeId]");
        const label = rest[1];
        const target = rest[2];
        const { count } = await client.from("choices").select("id", { count: "exact", head: true }).eq("node_id", nodeId);
        const c = await insertChoice(client, nodeId, count ?? 0);
        if (label !== void 0 || target !== void 0) {
          await updateChoiceRow(client, c.id, { ...label !== void 0 ? { label } : {}, ...target ? { target_node_id: target } : {} });
        }
        ok(c.id, `\u2713 Added choice ${c.id}`);
        return;
      }
      if (sub === "set") {
        const [choiceId, field, ...valueParts] = rest;
        const value = valueParts.join(" ");
        if (!choiceId || !field) die("Usage: talia choice set <choiceId> <label|target> <value>");
        if (field === "label") await updateChoiceRow(client, choiceId, { label: value });
        else if (field === "target") await updateChoiceRow(client, choiceId, { target_node_id: value || null });
        else die('field must be "label" or "target"');
        ok(choiceId, "\u2713 Updated");
        return;
      }
      if (sub === "rm") {
        if (!rest[0]) die("Usage: talia choice rm <choiceId>");
        await deleteChoiceRow(client, rest[0]);
        ok(rest[0], "\u2713 Removed");
        return;
      }
      if (sub === "present") {
        const [choiceId, ...jsonParts] = rest;
        const json = jsonParts.join(" ");
        if (!choiceId || !json) die(`Usage: talia choice present <choiceId> '{"skin":"preset:gilded","size":"l"}'`);
        const pres = normalizePresentation(JSON.parse(json));
        const { data } = await client.from("choices").select("interaction").eq("id", choiceId).single();
        const nextItx = writePresentation(data?.interaction, pres);
        await updateChoiceRow(client, choiceId, { interaction: nextItx });
        ok(choiceId, "\u2713 Presentation set");
        return;
      }
      if (sub === "tap") {
        const [choiceId, x, y, w, h, ...hintParts] = rest;
        if (!choiceId || x === void 0 || y === void 0 || w === void 0 || h === void 0) {
          die("Usage: talia choice tap <choiceId> <x> <y> <w> <h> [hint]  (normalized 0..1)");
        }
        const hint = hintParts.join(" ");
        const tap_region = { x: Number(x), y: Number(y), w: Number(w), h: Number(h), ...hint ? { hint } : {} };
        await updateChoiceRow(client, choiceId, { choice_type: "tap_region", tap_region });
        ok(choiceId, "\u2713 Tap region set (choice_type \u2192 tap_region)");
        return;
      }
      if (sub === "interaction") {
        const [choiceId, ...jsonParts] = rest;
        const json = jsonParts.join(" ");
        if (!choiceId || !json) die(`Usage: talia choice interaction <choiceId> '{"template":"hotspot_collect","hitGoto":"<nodeId>","defaultGoto":"<nodeId>","params":{"needK":3}}'`);
        const spec = JSON.parse(json);
        if (!spec.template) die('interaction json needs a "template" (e.g. hotspot_collect, bullet_time, combo_rated, wipe_reveal, roaming_reticle, timing_meter)');
        const model = {
          template: spec.template,
          anchorMode: spec.anchorMode ?? "end",
          timepoint: spec.timepoint ?? 0,
          timedStart: spec.timedStart ?? 0,
          timedEnd: spec.timedEnd ?? 0,
          once: spec.once ?? false,
          hitGoto: spec.hitGoto ?? null,
          missGoto: spec.missGoto ?? null,
          defaultGoto: spec.defaultGoto ?? null,
          params: { ...defaultParamsFor(spec.template), ...spec.params ?? {} },
          media: spec.media ?? {}
        };
        const s = serializeInteraction(model);
        const patch = {
          choice_type: "tap_region",
          interaction: s.interaction,
          target_node_id: s.targetNodeId
        };
        if (s.tapRegionGesture) {
          const { data } = await client.from("choices").select("tap_region").eq("id", choiceId).single();
          patch.tap_region = { ...data?.tap_region ?? {}, ...s.tapRegionGesture };
        }
        await updateChoiceRow(client, choiceId, patch);
        ok(choiceId, `\u2713 Interaction set (template=${spec.template})`, { template: spec.template });
        return;
      }
      die("Unknown choice subcommand. Try: add | set | rm | present | tap | interaction");
      return;
    }
    case "choices": {
      const nodeId = sub;
      if (!nodeId) die("Usage: talia choices <nodeId>");
      const { client } = await getAuthedClient();
      const { data } = await client.from("choices").select("*").eq("node_id", nodeId).order("sort_order", { ascending: true });
      const choices = data ?? [];
      emit(choices, () => {
        for (const c of choices) console.log(`${c.id}  "${c.label}" -> ${c.target_node_id ? c.target_node_id.slice(0, 8) : "(none)"}  [${c.choice_type}]`);
        if (!choices.length) console.log("(no choices)");
      });
      return;
    }
    case "var": {
      const { client } = await getAuthedClient();
      if (sub === "add") {
        const [projectId, name, type, def] = rest;
        if (!projectId || !name || type !== "bool" && type !== "int") die("Usage: talia var add <projectId> <name> <bool|int> [default]");
        const defaultValue = def === void 0 ? void 0 : type === "bool" ? def === "true" : Number(def);
        const v = await insertVariable(client, { projectId, name, varType: type, defaultValue });
        ok(v.id, `\u2713 Added variable ${v.id}  ${v.name} (${v.var_type})`, { name: v.name, varType: v.var_type });
        return;
      }
      if (sub === "rm") {
        if (!rest[0]) die("Usage: talia var rm <varId>");
        await deleteVariableRow(client, rest[0]);
        ok(rest[0], "\u2713 Removed");
        return;
      }
      die("Unknown var subcommand. Try: add | rm");
      return;
    }
    case "vars": {
      const projectId = sub;
      if (!projectId) die("Usage: talia vars <projectId>");
      const { client } = await getAuthedClient();
      const { data } = await client.from("variables").select("*").eq("project_id", projectId).order("created_at", { ascending: true });
      const variables = data ?? [];
      emit(variables, () => {
        for (const v of variables) console.log(`${v.id}  ${v.name}  ${v.var_type}  default=${v.default_value}`);
        if (!variables.length) console.log("(no variables)");
      });
      return;
    }
    case "ach": {
      const { client } = await getAuthedClient();
      if (sub === "add") {
        const [projectId, name, emoji, ...descParts] = rest;
        if (!projectId || !name || !emoji) die("Usage: talia ach add <projectId> <name> <emoji> [description]");
        const description = descParts.length ? descParts.join(" ") : null;
        const a = await insertAchievement(client, { projectId, name, emoji, description, conditionExpr: null });
        ok(a.id, `\u2713 Added achievement ${a.id}  ${a.emoji} ${a.name}`, { name: a.name });
        return;
      }
      if (sub === "rm") {
        if (!rest[0]) die("Usage: talia ach rm <achId>");
        await deleteAchievementRow(client, rest[0]);
        ok(rest[0], "\u2713 Removed");
        return;
      }
      die("Unknown ach subcommand. Try: add | rm");
      return;
    }
    case "achs": {
      const projectId = sub;
      if (!projectId) die("Usage: talia achs <projectId>");
      const { client } = await getAuthedClient();
      const { data } = await client.from("achievements").select("*").eq("project_id", projectId).order("created_at", { ascending: true });
      const achievements = data ?? [];
      emit(achievements, () => {
        for (const a of achievements) console.log(`${a.id}  ${a.emoji} ${a.name}`);
        if (!achievements.length) console.log("(no achievements)");
      });
      return;
    }
    case "import-outline": {
      const projectId = sub;
      const file = rest[0];
      if (!projectId || !file) die("Usage: talia import-outline <projectId> <file.md>");
      const { client } = await getAuthedClient();
      await importOutline(client, projectId, file);
      return;
    }
    case "asset": {
      const { client, user } = await getAuthedClient();
      if (sub === "upload") {
        const [projectId, file] = rest;
        if (!projectId || !file) die("Usage: talia asset upload <projectId> <file>");
        const bytes = new Uint8Array(readFileSync2(file));
        const fileName = basename2(file);
        const mimeType = mimeFor(fileName);
        const kind = inferKindFromName(fileName, mimeType);
        const res = await uploadAsset(client, nodeTransport, {
          body: bytes,
          sizeBytes: bytes.byteLength,
          fileName,
          kind,
          mimeType,
          ownerId: user.id,
          projectId,
          pathPrefix: `cli/${projectId}`
        });
        ok(res.asset?.id ?? null, `\u2713 Uploaded ${res.url}${res.asset ? `  (asset ${res.asset.id})` : "  (not registered)"}`, { url: res.url });
        return;
      }
      if (sub === "rm") {
        if (!rest[0]) die("Usage: talia asset rm <assetId>");
        await deleteAssetRow(client, rest[0]);
        ok(rest[0], "\u2713 Removed");
        return;
      }
      die("Unknown asset subcommand. Try: upload | rm");
      return;
    }
    case "assets": {
      const projectId = sub;
      if (!projectId) die("Usage: talia assets <projectId>");
      const { client } = await getAuthedClient();
      const { data } = await client.from("assets").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      const assets = data ?? [];
      emit(assets, () => {
        for (const a of assets) console.log(`${a.id}  [${a.kind}]  ${a.original_filename ?? ""}  ${a.r2_url}`);
        if (!assets.length) console.log("(no assets)");
      });
      return;
    }
    default:
      die(`Unknown command "${cmd}". Run: talia help`);
  }
}
async function loadProject(client, projectId) {
  const proj = (await client.from("projects").select("*").eq("id", projectId).single()).data;
  if (!proj) die("Project not found (or not yours)");
  const nodes = (await client.from("nodes").select("*").eq("project_id", projectId).neq("status", "removed")).data ?? [];
  const nodeIds = nodes.map((n) => n.id);
  const choices = nodeIds.length ? (await client.from("choices").select("*").in("node_id", nodeIds)).data ?? [] : [];
  const variables = (await client.from("variables").select("*").eq("project_id", projectId)).data ?? [];
  const achievements = (await client.from("achievements").select("*").eq("project_id", projectId)).data ?? [];
  return [proj, nodes, choices, variables, achievements];
}
function parseOutline(text) {
  const nodes = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1], choices: [] };
      nodes.push(current);
      continue;
    }
    const choice = line.match(/^-\s*(.+?)\s*->\s*(.+?)\s*$/);
    if (choice && current) current.choices.push({ label: choice[1], target: choice[2] });
  }
  return nodes;
}
async function importOutline(client, projectId, file) {
  const outline = parseOutline(readFileSync2(file, "utf8"));
  if (!outline.length) die('No nodes found \u2014 expected "# Title" headings.');
  const idByTitle = /* @__PURE__ */ new Map();
  let firstId = null;
  for (let i = 0; i < outline.length; i++) {
    const { dbFields, node } = buildNewNode({ projectId, x: 0, y: i * 220, title: outline[i].title });
    const { error } = await insertNode(client, dbFields);
    if (error) die(`node "${outline[i].title}": ${String(error.message ?? error)}`);
    idByTitle.set(outline[i].title, node.id);
    if (i === 0) firstId = node.id;
  }
  let choiceCount = 0;
  const unresolved = [];
  for (const n of outline) {
    const nodeId = idByTitle.get(n.title);
    let sort = 0;
    for (const ch of n.choices) {
      const target = idByTitle.get(ch.target) ?? null;
      if (!target) unresolved.push(`${n.title} -> ${ch.target}`);
      const c = await insertChoice(client, nodeId, sort++);
      await updateChoiceRow(client, c.id, { label: ch.label, target_node_id: target });
      choiceCount++;
    }
  }
  if (firstId) await updateProjectRow(client, projectId, { start_node_id: firstId });
  console.log(`\u2713 Imported ${outline.length} nodes, ${choiceCount} choices${firstId ? `, Start = "${outline[0].title}"` : ""}`);
  if (unresolved.length) {
    console.log(`\u26A0 ${unresolved.length} choice(s) point to unknown nodes (target left unset):`);
    for (const u of unresolved) console.log(`  ${u}`);
  }
}
main().catch((err) => die(errMsg(err)));
export {
  parseOutline
};
