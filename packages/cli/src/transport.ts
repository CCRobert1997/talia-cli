// Node upload transport injected into core's uploadAsset (ADR-001 assets seam).
// fetch-based presign + PUT (Cloudflare blocks non-browser UAs → send a browser UA).
// No metadata extractor yet — CLI uploads land with width/height/duration null
// (acceptable; a future ffprobe/sharp extractor can be injected here).
import { basename } from 'node:path'
import type { UploadTransport } from '@talia/authoring-core/ops/assets'

const UPLOAD_WORKER = process.env.UPLOAD_WORKER_URL ?? 'https://upload.taliaapp.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export const nodeTransport: UploadTransport = {
  async presign({ fileType, fileName, contentType, pathPrefix }) {
    const r = await fetch(`${UPLOAD_WORKER}/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ fileType, fileName, nodeId: pathPrefix, contentType }),
    })
    if (!r.ok) throw new Error(`presign failed: ${r.status}`)
    return r.json() as Promise<{ uploadUrl: string; publicUrl: string }>
  },
  async putBytes(uploadUrl, bytes, contentType) {
    const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, 'User-Agent': UA }, body: bytes })
    if (!r.ok) throw new Error(`upload PUT failed: ${r.status}`)
  },
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v', mkv: 'video/x-matroska',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
}

export function mimeFor(fileName: string): string {
  const ext = basename(fileName).toLowerCase().split('.').pop() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}
