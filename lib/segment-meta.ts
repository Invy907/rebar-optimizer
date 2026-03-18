import type { DrawingSegment } from '@/lib/types/database'

export type SegmentColor = 'red' | 'blue'

export type SegmentBarItem = {
  barType: string
  quantity: number
}

export type SegmentMetaV1 = {
  v: 1
  color: SegmentColor | null
  bars: SegmentBarItem[]
  note: string | null
}

function normalizeBars(bars: SegmentBarItem[]): SegmentBarItem[] {
  const merged = new Map<string, number>()
  for (const b of bars) {
    const bt = (b.barType ?? '').trim()
    const qty = Math.max(0, Math.floor(Number(b.quantity) || 0))
    if (!bt || qty <= 0) continue
    merged.set(bt, (merged.get(bt) ?? 0) + qty)
  }
  return Array.from(merged.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([barType, quantity]) => ({ barType, quantity }))
}

export function decodeSegmentMeta(
  memo: string | null,
): { meta: SegmentMetaV1 | null; legacyNote: string | null } {
  if (!memo) return { meta: null, legacyNote: null }
  try {
    const obj = JSON.parse(memo) as unknown
    if (!obj || typeof obj !== 'object') return { meta: null, legacyNote: memo }
    const r = obj as Record<string, unknown>
    if (r.v !== 1) return { meta: null, legacyNote: memo }
    const colorRaw = r.color
    const barsRaw = r.bars
    const noteRaw = r.note

    const color: SegmentColor | null =
      colorRaw === 'red' || colorRaw === 'blue' ? colorRaw : null

    const bars: SegmentBarItem[] = Array.isArray(barsRaw)
      ? barsRaw
          .map((x) => {
            if (!x || typeof x !== 'object') return null
            const xx = x as Record<string, unknown>
            return {
              barType: String(xx.barType ?? '').trim(),
              quantity: Math.floor(Number(xx.quantity) || 0),
            }
          })
          .filter((x): x is SegmentBarItem => !!x)
      : []

    const note =
      typeof noteRaw === 'string' ? noteRaw : noteRaw == null ? null : String(noteRaw)

    return {
      meta: {
        v: 1,
        color,
        bars: normalizeBars(bars),
        note: note?.trim() ? note : null,
      },
      legacyNote: null,
    }
  } catch {
    return { meta: null, legacyNote: memo }
  }
}

export function encodeSegmentMeta(meta: SegmentMetaV1): string | null {
  const normalized: SegmentMetaV1 = {
    v: 1,
    color: meta.color ?? null,
    bars: normalizeBars(meta.bars ?? []),
    note: meta.note?.trim() ? meta.note : null,
  }
  if (!normalized.color && normalized.bars.length === 0 && !normalized.note) return null
  return JSON.stringify(normalized)
}

export function getSegmentMetaForRebar(seg: DrawingSegment): SegmentMetaV1 {
  const { meta, legacyNote } = decodeSegmentMeta(seg.memo)
  if (meta) {
    return {
      ...meta,
      color: meta.color ?? 'red',
      bars: meta.bars.length
        ? meta.bars
        : normalizeBars([{ barType: seg.bar_type, quantity: seg.quantity }]),
      note: meta.note ?? (legacyNote?.trim() ? legacyNote : null),
    }
  }
  return {
    v: 1,
    color: 'red',
    bars: normalizeBars([{ barType: seg.bar_type, quantity: seg.quantity }]),
    note: legacyNote?.trim() ? legacyNote : null,
  }
}

export function getSegmentColor(seg: DrawingSegment): SegmentColor {
  const isSpacing = seg.bar_type === 'SPACING' && seg.quantity === 0
  if (isSpacing) return 'red'
  const { meta } = decodeSegmentMeta(seg.memo)
  return meta?.color ?? 'red'
}

export function getSegmentBars(seg: DrawingSegment): SegmentBarItem[] {
  const isSpacing = seg.bar_type === 'SPACING' && seg.quantity === 0
  if (isSpacing) return []
  const { meta } = decodeSegmentMeta(seg.memo)
  if (meta?.bars?.length) return meta.bars
  const bt = (seg.bar_type ?? '').trim()
  const qty = Math.max(0, Math.floor(Number(seg.quantity) || 0))
  return bt && qty > 0 ? [{ barType: bt, quantity: qty }] : []
}

export function getSegmentBarsSummary(seg: DrawingSegment): string {
  const bars = getSegmentBars(seg)
  if (bars.length === 0) return '-'
  return bars.map((b) => `${b.barType}×${b.quantity}`).join(', ')
}

export function getTotalBarQuantity(seg: DrawingSegment): number {
  return getSegmentBars(seg).reduce((s, b) => s + b.quantity, 0)
}

export function legacyFieldsFromBars(bars: SegmentBarItem[]): {
  bar_type: string
  quantity: number
} {
  const normalized = normalizeBars(bars)
  if (normalized.length === 1) {
    return { bar_type: normalized[0].barType, quantity: normalized[0].quantity }
  }
  return {
    bar_type: normalized.length === 0 ? 'D10' : 'MIXED',
    quantity: normalized.reduce((s, b) => s + b.quantity, 0),
  }
}

