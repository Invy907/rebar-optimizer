import type { DrawingSegment, Unit } from '@/lib/types/database'
import {
  isSegmentColor,
  normalizeSegmentColor,
  SEGMENT_COLOR_ORDER,
  type SegmentColor,
} from '@/lib/segment-colors'

export type { SegmentColor } from '@/lib/segment-colors'

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

    const color: SegmentColor | null = isSegmentColor(colorRaw) ? colorRaw : null

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
      color: normalizeSegmentColor(meta.color ?? 'red'),
      bars: meta.bars.length
        ? meta.bars
        : normalizeBars([{ barType: seg.bar_type, quantity: seg.quantity }]),
      note: meta.note ?? (legacyNote?.trim() ? legacyNote : null),
    }
  }
  return {
    v: 1,
    color: normalizeSegmentColor('red'),
    bars: normalizeBars([{ barType: seg.bar_type, quantity: seg.quantity }]),
    note: legacyNote?.trim() ? legacyNote : null,
  }
}

/** 線分に割当済みのユニットを解決（一覧に無い場合は null） */
export function resolveLinkedUnit(
  seg: DrawingSegment,
  units?: Unit[] | null,
): Unit | null {
  const uid = seg.unit_id
  if (!uid) return null
  const list = units ?? []
  return list.find((u) => u.id === uid) ?? null
}

/**
 * 切断・一覧表示用の長さ (mm)。割当ユニットの length_mm があれば優先、なければ線分の length_mm。
 */
export function getSegmentEffectiveLengthMm(
  seg: DrawingSegment,
  units?: Unit[] | null,
): number {
  const u = resolveLinkedUnit(seg, units)
  const unitLen = u?.length_mm
  if (typeof unitLen === 'number' && Number.isFinite(unitLen)) {
    return unitLen
  }
  return seg.length_mm
}

/**
 * 表示用の線の色。unit_id がありユニットが解決できればユニットの色、否则 memo / 既定。
 */
export function getSegmentColor(
  seg: DrawingSegment,
  units?: Unit[] | null,
): SegmentColor {
  const isSpacing = seg.bar_type === 'SPACING' && seg.quantity === 0
  if (isSpacing) return 'red'
  const u = resolveLinkedUnit(seg, units)
  if (u && u.is_active !== false) return normalizeSegmentColor(u.color)
  const { meta } = decodeSegmentMeta(seg.memo)
  return normalizeSegmentColor(meta?.color)
}

function parseMarkFromCode(code: string | null | undefined): number | null {
  if (!code) return null
  const m = code.trim().match(/-(\d+)$/)
  if (!m) return null
  const n = Number.parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/**
 * 線分の表示マーク番号を解決。
 * 優先順: linked unit.mark_number -> seg.mark_number -> seg.unit_code末尾数字 -> linked unit.code末尾数字
 */
export function getSegmentResolvedMarkNumber(
  seg: DrawingSegment,
  units: Unit[] | null | undefined,
): number | null {
  const u = resolveLinkedUnit(seg, units)
  if (u && u.mark_number != null) return u.mark_number
  if (seg.mark_number != null) return seg.mark_number
  const markFromSegCode = parseMarkFromCode(seg.unit_code)
  if (markFromSegCode != null) return markFromSegCode
  const markFromUnitCode = parseMarkFromCode(u?.code)
  if (markFromUnitCode != null) return markFromUnitCode
  return null
}

/**
 * 円内に表示するマーク番号。長さベース採番へのフォールバックは行わない。
 */
export function getSegmentMarkNumberForCanvas(
  seg: DrawingSegment,
  units: Unit[] | null | undefined,
): number | null {
  return getSegmentResolvedMarkNumber(seg, units)
}

/**
 * 鉄筋線分のみ対象。各色グループ内で長さ降順に 1 から円番号を割り当てるマップを返す。
 */
export function buildCircleNoByLengthPerColor(
  rebarSegments: DrawingSegment[],
  units?: Unit[] | null,
): Map<SegmentColor, Map<number, number>> {
  const result = new Map<SegmentColor, Map<number, number>>()
  for (const color of SEGMENT_COLOR_ORDER) {
    const lens = Array.from(
      new Set(
        rebarSegments
          .filter((s) => getSegmentColor(s, units) === color)
          .map((s) => s.length_mm),
      ),
    ).sort((a, b) => b - a)
    result.set(color, new Map(lens.map((len, idx) => [len, idx + 1])))
  }
  return result
}

/** 円サマリ等の表示用：各色の (長さ→本数) と番号付け（番号はユニット由来を優先） */
export function buildCircleSummaryByColor(
  rebarSegments: DrawingSegment[],
  units?: Unit[] | null,
) {
  const countByColorLenMark = new Map<SegmentColor, Map<string, number>>()
  for (const color of SEGMENT_COLOR_ORDER) {
    countByColorLenMark.set(color, new Map())
  }
  for (const seg of rebarSegments) {
    const c = getSegmentColor(seg, units)
    const m = countByColorLenMark.get(c)
    if (!m) continue
    const mark = getSegmentResolvedMarkNumber(seg, units)
    const lenMm = getSegmentEffectiveLengthMm(seg, units)
    const k = `${lenMm}::${mark ?? ''}`
    m.set(k, (m.get(k) ?? 0) + 1)
  }

  const sections: {
    color: SegmentColor
    rows: { len: number; no: number | null; count: number }[]
  }[] = []

  for (const color of SEGMENT_COLOR_ORDER) {
    const counts = countByColorLenMark.get(color)
    if (!counts) continue
    const rows = Array.from(counts.entries())
      .map(([k, count]) => {
        const [lenRaw, noRaw] = k.split('::')
        const len = Number.parseInt(lenRaw ?? '', 10)
        const no = noRaw ? Number.parseInt(noRaw, 10) : null
        return {
          len: Number.isFinite(len) ? len : 0,
          no: no != null && Number.isFinite(no) ? no : null,
          count,
        }
      })
      .sort((a, b) => {
        const aNo = a.no ?? Number.MAX_SAFE_INTEGER
        const bNo = b.no ?? Number.MAX_SAFE_INTEGER
        if (aNo !== bNo) return aNo - bNo
        return b.len - a.len
      })
    if (rows.some((r) => r.count > 0)) {
      sections.push({ color, rows })
    }
  }

  return sections
}

export function getSegmentBars(
  seg: DrawingSegment,
  units?: Unit[] | null,
): SegmentBarItem[] {
  const isSpacing = seg.bar_type === 'SPACING' && seg.quantity === 0
  if (isSpacing) return []
  const u = resolveLinkedUnit(seg, units)
  if (u && u.is_active !== false && u.bars?.length) {
    return normalizeBars(
      u.bars.map((b) => ({
        barType: b.diameter,
        quantity: b.qtyPerUnit,
      })),
    )
  }
  const { meta } = decodeSegmentMeta(seg.memo)
  if (meta?.bars?.length) return meta.bars
  const bt = (seg.bar_type ?? '').trim()
  const qty = Math.max(0, Math.floor(Number(seg.quantity) || 0))
  return bt && qty > 0 ? [{ barType: bt, quantity: qty }] : []
}

export function getSegmentBarsSummary(
  seg: DrawingSegment,
  units?: Unit[] | null,
): string {
  const bars = getSegmentBars(seg, units)
  if (bars.length === 0) return '-'
  return bars.map((b) => `${b.barType}×${b.quantity}`).join(', ')
}

export function getTotalBarQuantity(
  seg: DrawingSegment,
  units?: Unit[] | null,
): number {
  return getSegmentBars(seg, units).reduce((s, b) => s + b.quantity, 0)
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

