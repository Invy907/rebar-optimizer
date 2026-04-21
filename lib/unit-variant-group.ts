import type { Unit } from '@/lib/types/database'
import { normalizeSegmentColor } from '@/lib/segment-colors'

/** 長さ・マーク・コード以外が同一のユニットをまとめるキー（/units のバリアント行と一致） */
export function unitVariantGroupKey(u: Unit): string {
  return JSON.stringify({
    name: u.name ?? '',
    location_type: u.location_type ?? '',
    shape_type: u.shape_type ?? '',
    color: normalizeSegmentColor(u.color),
    template_id: u.template_id ?? '',
    detail_spec: u.detail_spec ?? null,
    detail_geometry: u.detail_geometry ?? null,
    rebar_layout: u.rebar_layout ?? null,
    bars: u.bars ?? [],
    spacing_mm: u.spacing_mm ?? null,
    pitch_mm: u.pitch_mm ?? null,
    description: u.description ?? null,
  })
}

export function listUnitVariantsInGroup(allUnits: Unit[], unit: Unit): Unit[] {
  const key = unitVariantGroupKey(unit)
  return allUnits
    .filter((x) => unitVariantGroupKey(x) === key)
    .slice()
    .sort((a, b) => (a.mark_number ?? 9999) - (b.mark_number ?? 9999))
}

export function unitVariantLengthMm(u: Unit): number | null {
  if (u.length_mm != null && Number.isFinite(u.length_mm)) return u.length_mm
  if (u.spacing_mm != null && Number.isFinite(u.spacing_mm)) return u.spacing_mm
  return null
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] as const

/** マーク番号（なければ表示用インデックス）を 1–10 は丸数字で表示 */
export function formatVariantMarkBadge(markOrIndex: number): string {
  if (markOrIndex >= 1 && markOrIndex <= CIRCLED.length) return CIRCLED[markOrIndex - 1]!
  return `${markOrIndex}`
}
