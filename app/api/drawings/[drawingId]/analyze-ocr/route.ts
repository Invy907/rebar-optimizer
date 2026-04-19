import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeImageWithGoogleVision } from '@/lib/ocr/google-vision'
import type { Drawing } from '@/lib/types/database'

function toThumbPath(filePath: string): string {
  const parts = filePath.split('/')
  const base = parts[parts.length - 1] ?? 'drawing'
  const dir = parts.slice(0, -1).join('/')
  return `${dir}/${base}.thumb.png`
}

async function fetchBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch file: ${res.status}`)
  }
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ drawingId: string }> },
) {
  try {
    const { drawingId } = await ctx.params
    const supabase = await createClient()

    const { data: drawing, error: drawErr } = await supabase
      .from('drawings')
      .select('*')
      .eq('id', drawingId)
      .single<Drawing>()
    if (drawErr || !drawing) {
      return NextResponse.json({ error: 'Drawing not found' }, { status: 404 })
    }

    let targetPath = drawing.file_path
    if (drawing.file_type === 'pdf') {
      targetPath = toThumbPath(drawing.file_path)
    }

    const signed = await supabase.storage
      .from('drawings')
      .createSignedUrl(targetPath, 120)

    let signedUrl = signed.data?.signedUrl ?? null
    if (!signedUrl && drawing.file_type === 'pdf') {
      const fallback = await supabase.storage
        .from('drawings')
        .createSignedUrl(drawing.file_path, 120)
      signedUrl = fallback.data?.signedUrl ?? null
    }
    if (!signedUrl) {
      return NextResponse.json({ error: 'Failed to create signed URL' }, { status: 500 })
    }

    const bytes = await fetchBinary(signedUrl)
    const tokens = await analyzeImageWithGoogleVision(bytes)
    const normalized = tokens.map((t) => {
      const raw = t.text.trim()
      const compact = raw.replace(/\s+/g, '')
      const isBarType = /^D\d+$/i.test(compact)
      const isLength = /^-?\d{1,3}(,\d{3})*$/.test(compact) || /^\d+$/.test(compact)
      const isMark = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]$/.test(compact)
      return {
        ...t,
        text: raw,
        normalizedText: compact,
        kind: isBarType ? 'bar' : isMark ? 'mark' : isLength ? 'length' : 'other',
      }
    })

    return NextResponse.json({
      drawingId,
      sourcePath: targetPath,
      count: normalized.length,
      tokens: normalized,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
