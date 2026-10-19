// Asset ops — framework-agnostic (ADR-001 phase 2/3, assets seam). Upload is split
// so it runs in BOTH the browser and node: core owns the orchestration + the assets
// registry insert, while the transport (presign + PUT) and optional media-metadata
// extraction are INJECTED. The editor injects XHR + DOM extractors; the CLI injects
// fetch + (for now) no extractor. This is why assets waited for a seam decision:
// node has no DOM to read width/height/duration.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset, AssetKind } from '../model'

export function inferBucket(kind: AssetKind): 'player-videos' | 'player-images' {
  return kind === 'video' ? 'player-videos' : 'player-images'
}

export function parseR2Key(publicUrl: string): string {
  try { return new URL(publicUrl).pathname.replace(/^\//, '') } catch { return publicUrl }
}

export function inferKindFromName(name: string, mime?: string): AssetKind {
  const lower = name.toLowerCase().split('?')[0]
  if (/\.(mp4|mov|webm|m4v|mkv)$/.test(lower) || mime?.startsWith('video/')) return 'video'
  if (/\.(jpg|jpeg|png|webp|gif|avif)$/.test(lower) || mime?.startsWith('image/')) return 'image'
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(lower) || mime?.startsWith('audio/')) return 'audio'
  return 'other'
}

export interface AssetMeta { width: number | null; height: number | null; durationMs: number | null }
const NO_META: AssetMeta = { width: null, height: null, durationMs: null }

// Body accepted by the transport: raw bytes (node) or a Blob/File (browser, streamed
// by XHR — avoids reading a large video fully into memory).
export type UploadBody = Uint8Array | Blob

// Injected transport + optional extractor. The editor injects XHR-with-progress + DOM
// metadata; the CLI injects fetch (+ no extractor). extractMeta takes no args — each
// transport closes over its own source (a File in the browser, bytes in node).
export interface UploadTransport {
  presign: (args: { fileType: 'video' | 'image'; fileName: string; contentType: string; pathPrefix: string }) => Promise<{ uploadUrl: string; publicUrl: string }>
  putBytes: (uploadUrl: string, body: UploadBody, contentType: string) => Promise<void>
  extractMeta?: () => Promise<AssetMeta>
}

export interface UploadAssetInput {
  body: UploadBody
  fileName: string
  kind: AssetKind
  mimeType: string
  ownerId: string
  projectId?: string | null
  pathPrefix: string
  sizeBytes: number
}

// Insert one row into the assets registry (all editor uploads must be registered).
export async function registerAsset(client: SupabaseClient, row: Record<string, unknown>): Promise<Asset> {
  const { data, error } = await client.from('assets').insert(row).select().single()
  if (error) throw error
  return data as Asset
}

export async function deleteAssetRow(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('assets').delete().eq('id', id)
  if (error) throw error
}

// Orchestrate an upload: presign → extract meta (if a extractor is injected) → PUT →
// register. Registry insert is best-effort (matches the editor). Returns the public
// URL + registry id.
export async function uploadAsset(
  client: SupabaseClient,
  transport: UploadTransport,
  input: UploadAssetInput,
): Promise<{ url: string; key: string; bucket: string; asset: Asset | null }> {
  const fileType: 'video' | 'image' = input.kind === 'video' ? 'video' : 'image'
  const { uploadUrl, publicUrl } = await transport.presign({
    fileType,
    fileName: input.fileName,
    contentType: input.mimeType,
    pathPrefix: input.pathPrefix,
  })
  const meta = transport.extractMeta ? await transport.extractMeta() : NO_META
  await transport.putBytes(uploadUrl, input.body, input.mimeType)

  const key = parseR2Key(publicUrl)
  const bucket = inferBucket(input.kind)
  let asset: Asset | null = null
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
      duration_ms: meta.durationMs,
    })
  } catch (err) {
    console.error('[uploadAsset] registry insert failed:', err)
  }
  return { url: publicUrl, key, bucket, asset }
}
